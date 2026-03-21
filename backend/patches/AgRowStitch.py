# -*- coding: utf-8 -*-
"""
Created on Thu Dec 19 16:33:41 2024

@author: Kaz Uyehara
"""
import cv2
import copy
from lightglue import LightGlue, SuperPoint #git clone https://github.com/cvg/LightGlue.git && cd LightGlue
from lightglue.utils import rbd
import logging
import itertools
import multiprocessing
import numpy as np
import os
import pandas as pd
import re
import scipy as sp
import shutil
import sys
import time
import torch
from torchvision import transforms
import yaml

def read_image(img_path, config):
    #########################################
    #Read image then mask, change resolution#
    #and reorient according to config       #
    #########################################
    image = cv2.imread(img_path) #Read image and then resize
    xdim, ydim = image.shape[1], image.shape[0] #original dimensions
    x_start, right, y_start, bottom = config["mask"]
    x_end = int(xdim - right)
    y_end = int(ydim - bottom)
    
    ###################################################
    #Crop out borders if there is a mask in the config#
    ###################################################
    image = image[int(y_start):y_end, int(x_start):x_end]
    image = cv2.resize(image, dsize = None,
                       fx = config["final_resolution"],
                       fy = config["final_resolution"])
    
    #############################################################################
    #Rotate image based on stitching direction so that stitching edge is on left#
    #############################################################################
    if config["stitching_direction"] == 'RIGHT':
        #Flip image across vertical axis so the stitching edge is now on the left
        image = cv2.flip(image, 1)
    elif config["stitching_direction"] == 'UP':
        #Rotate 90 degrees CCW so stitching edge is now on the left
        image = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
    elif config["stitching_direction"] == 'DOWN':
        #Rotate 90 degrees CCW so stitching edge is now on the left
        image = cv2.rotate(image, cv2.ROTATE_90_CLOCKWISE)
    return image

def extract_features(img_path, config):
    ##################################
    #Load image and change resolution#
    ##################################
    image = read_image(img_path, config)

    ####################################
    #Use SuperPoint to extract features#
    ####################################
    extractor = SuperPoint(max_num_keypoints=2048).eval().to(config["device"])
    image_resized_tensor = transforms.ToTensor()(image).to(config["device"]).unsqueeze(0)
    with torch.no_grad():
        feats = extractor.extract(image_resized_tensor)
        feats['scores'] = feats.get('scores', torch.ones((1, feats['keypoints'].shape[1]), device=feats['keypoints'].device))
        feats = rbd(feats)
        feats['keypoints'] = feats['keypoints'].unsqueeze(0)
        feats['descriptors'] = feats['descriptors'].unsqueeze(0)
        feats['keypoint_scores']= feats['keypoint_scores']
    return feats
        
def get_inliers(img_feats, img_paths, src_idx, dst_idx, config):
    ###########################################################
    #Use LightGlue to match features extracted from SuperPoint#
    ###########################################################
    config["logger"].debug("Finding matches between image {}  and image {}".format(src_idx, dst_idx))
    #Only extract features if not already present to minimize VRAM use
    if src_idx not in img_feats:
        img_feats[src_idx] = extract_features(img_paths[src_idx], config)
    if dst_idx not in img_feats:
        img_feats[dst_idx] = extract_features(img_paths[dst_idx], config)
    matcher = LightGlue(features="superpoint").eval().to(config["device"])
    feat_dict = {'image0': img_feats[src_idx], 'image1': img_feats[dst_idx]}
    img_matches = matcher(feat_dict)
    feats0, feats1, img_matches = [rbd(x) for x in [feat_dict['image0'], feat_dict['image1'], img_matches]]
    kpts0, kpts1, matches = feats0["keypoints"], feats1["keypoints"], img_matches["matches"]
    
    ###################################################
    #Find which keypoints were matched and move to cpu#
    ###################################################
    m_kpts0, m_kpts1 = kpts0[matches[..., 0]], kpts1[matches[..., 1]]
    m_kpts0_np = m_kpts0.cpu().numpy()
    m_kpts1_np = m_kpts1.cpu().numpy()
    img_dim = config["img_dims"][0]
    
    ##############################################
    #Subset the matching points based on position#
    ##############################################
    #We prefer the images to have keypoints close to their stitching edge so that keypoints are
    #unlikely to appear more than twice and we can minimize the number of images used.
    #The keypoint prop is the part of the image we expect to find keypoints, e.g. if 
    #keypoint prop is 0.5, we want the keypoints to be on the correct half of both images -- 
    #closer to the stitching edge than the non-stitching edge
    keypoint_prop_dict = {} #assume keys will stay ordered
    #We assume that for forward movement a keypoint_prop of at least 0.9 is necessary, so it is the upper limit
    for keypoint_prop in np.arange(config["keypoint_prop"], 1.0, 0.1): 
        src_pixel_limit = img_dim*(keypoint_prop)
        dst_pixel_limit = img_dim*(1 - keypoint_prop)
        filtered_idx = np.where((m_kpts0_np[:,0] < src_pixel_limit) & (m_kpts1_np[:,0] > dst_pixel_limit))
        #Need at least four points to find a transform
        if len(filtered_idx[0]) > 3:
            keypoint_prop_dict[keypoint_prop] = filtered_idx
            
    if len(keypoint_prop_dict) > 0:
        ###########################
        #Clean keypoint dictionary#
        ###########################
        #No need to retry with different keypoint_prop if it doesn't increase the number of inliers
        #so remove keys where we do not gain inliers from previous keypoint prop
        last_value = len(list(keypoint_prop_dict.items())[0][1][0])
        clean_dict = {list(keypoint_prop_dict.items())[0][0]: list(keypoint_prop_dict.items())[0][1]}
        for key, value in list(keypoint_prop_dict.items())[1:]:
            if len(value[0]) > last_value:
                clean_dict[key] = value
                last_value = len(value[0])
    
        ####################################################
        #Filter based on keypoint distances from each other#
        ####################################################
        for keypoint_prop, filtered_idx in clean_dict.items():
            #We want src points to be close to dst points in global space, so we exclude points that are
            #on the wrong part of the image to try to get the minimal images necessary and keypoints that are
            #unlikely to be present in more than two images.
            m_kpts0_f = m_kpts0_np[filtered_idx]
            m_kpts1_f = m_kpts1_np[filtered_idx]
            
            if len(m_kpts0_f) >= config["min_inliers"]:
                #Changing the RANSAC threshold parameter will determine if we get more but noisier matches (higher value)
                #or fewer but more pixel-perfect matches (lower value). Lower values help ensure that the OpenCV Matcher
                #will also match the points.
                transformation_matrix = None
                config["logger"].debug("Found {} inliers with keypoint filter of {}".format(len(m_kpts0_f), keypoint_prop))
                    
                ######################################################
                #Filter based on RANSAC threshold and minimum inliers#
                ###################################################### 
                #Use lowest RANSAC threshold possible to meet minimum inliers
                for RANSAC_threshold in range(1, int(config["max_RANSAC_thresh"]) + 1):
                    H, mask = cv2.findHomography(m_kpts0_f, m_kpts1_f, cv2.RANSAC, RANSAC_threshold)
                    if np.sum(mask) >= config["min_inliers"]:
                        config["logger"].debug("Using RANSAC threshold of {} to get {} inliers".format(RANSAC_threshold, np.sum(mask)))
                        transformation_matrix = H
                        break
                    
                ########################################
                #Filter based on homography constraints#
                ########################################
                if transformation_matrix is not None:
                    stitch_movement = transformation_matrix[0, 2]
                    forward_vs_lateral = abs(transformation_matrix[0,2]/transformation_matrix[1,2] + 0.001)
                    scale = (transformation_matrix[0,0]**2 + transformation_matrix[1,0]**2)**0.5 #estimate scale factor
                    #We only want matches where the homography matrix indicates that there is positive movement in the
                    #stitching direction, there is more movement in the stitching direction that the normal, and that
                    #the distance of the camera from the plane is not changing too much. We also need sufficient points
                    #that match this homography or we risk the OpenCV Matcher failing to match the points.
                    if (((stitch_movement > 0) and forward_vs_lateral > config["xy_ratio"]) and 
                        (abs(scale - 1.0) < config["scale_constraint"])):
                        k0_idx = matches[:,0].cpu().numpy()[filtered_idx][mask.astype(bool).flatten()]
                        k1_idx = matches[:,1].cpu().numpy()[filtered_idx][mask.astype(bool).flatten()]
                        preselect_kp0, preselect_feat0 = kpts0[k0_idx].cpu().numpy(), feats0['descriptors'][k0_idx].cpu().numpy()
                        preselect_kp1, preselect_feat1 = kpts1[k1_idx].cpu().numpy(), feats1['descriptors'][k1_idx].cpu().numpy()
                        mean_error, _ = get_LMEDS_error(preselect_kp0, preselect_kp1, config)
                        config["logger"].debug("Initial reprojection error of: {}".format(mean_error))
    
                        ####################################################################################################
                        #Filter out what we believe to be the most non-planar points so that we can optimize the homography#
                        ####################################################################################################
                        #Once we have excluded extreme outliers, try to find the best points to use to find the final homography matrix.
                        #Since RANSAC can quickly exclude points but may not find an optimal solution, even when the RANSAC threshold is low,
                        #we try to remove outliers using a brute force method.
                        """TO DO: This brute force method can probably be further optimized, but the cv2 implementation is fast enough
                        that it is not currently a problem"""
                        idx = np.arange(len(preselect_kp0)) #use to keep track of the final indices to keep
                        idx = idx[:, None] #make column vector
                        idx_kp0 = np.hstack((idx, preselect_kp0)) #add idx to the keypoints
                        idx_kp1 = np.hstack((idx, preselect_kp1))
                        maximum_removals = int(len(preselect_kp0) - config["min_inliers"])
                        error_array = full_outlier_function(preselect_kp0, preselect_kp1, maximum_removals, config)
                        if len(error_array) > 0:
                            best_idx = np.argmin(error_array[:,1])
                            best_iterations = int(error_array[best_idx, 0]) #Find best number of points to remove to minimize mean error
                            mean_error = error_array[best_idx, 1]
                        else:
                            best_iterations = 0
                        #Recreate the outlier removal to recover the optimal set of points
                        idx_to_keep = incremental_outlier_removal(idx_kp0, idx_kp1, best_iterations, config)
                        preselect_kp0, preselect_feat0 = preselect_kp0[idx_to_keep], preselect_feat0[idx_to_keep]
                        preselect_kp1, preselect_feat1 = preselect_kp1[idx_to_keep], preselect_feat1[idx_to_keep]
    
                        ####################################
                        #Filter based on reprojection error#
                        ####################################
                        if mean_error <= config["max_reprojection_error"]:
                            config["logger"].debug("{} inliers after filtering, for a final reprojection error of: {}".format(len(preselect_kp0), mean_error))
                            return (img_feats, True, preselect_kp0, preselect_feat0, preselect_kp1, preselect_feat1, mean_error, RANSAC_threshold, keypoint_prop)
                        else:
                            config["logger"].debug("Minimum error of {} was above error threshold, consider adjusting max_reprojection_error".format(mean_error))
                    else:
                        if stitch_movement <= 0:
                            config["logger"].debug("Rejecting match because camera not moving forward")
                        if forward_vs_lateral < config["xy_ratio"]:
                            config["logger"].debug("Low movement ratio of {} in the non-stitching direction, consider adjusting xy_ratio".format(forward_vs_lateral))
                        if abs(scale - 1.0) > config["scale_constraint"]:
                            config["logger"].debug("Scale difference between images is too high at {} consider adjusting scale_constraint".format(abs(scale - 1.0)))
                else:
                    config["logger"].debug("Could not find sufficient RANSAC inliers, consider increasing max_RANSAC_thresh")
            else:
                config["logger"].debug("Only found {} inliers with keypoint filter of {} consider increasing min_inliers".format(len(m_kpts0_f), keypoint_prop))
    
        ########################################################################
        #Force to match with image if this is there are no more images to check#
        ########################################################################
        if dst_idx - src_idx == 1:
            config["logger"].warning("Cannot find good matches, so forced to match image {} and {}, consider increasing max_reprojection error".format(src_idx, dst_idx))
            #If the filters exclude the match, pass the original match points in the most generous
            #RANSAC inliers and features as a last resort
            H, default_mask = cv2.findHomography(m_kpts0_np, m_kpts1_np, cv2.RANSAC, config["max_RANSAC_thresh"])
            k0_idx = matches[:,0].cpu().numpy()[default_mask.astype(bool).flatten()]
            k1_idx = matches[:,1].cpu().numpy()[default_mask.astype(bool).flatten()]
            preselect_kp0, preselect_feat0 = kpts0[k0_idx].cpu().numpy(), feats0['descriptors'][k0_idx].cpu().numpy()
            preselect_kp1, preselect_feat1 = kpts1[k1_idx].cpu().numpy(), feats1['descriptors'][k1_idx].cpu().numpy()
            mean_error, _ = get_LMEDS_error(preselect_kp0, preselect_kp1, config)
            return (img_feats, True, preselect_kp0, preselect_feat0, preselect_kp1, preselect_feat1, mean_error, None, 1.0)
        else:
            return (img_feats, False, None, None, None, None, None, None, 1.0)
    else:
        config["logger"].debug("Could not find any matches, consider decreasing forward_limit")
        return (img_feats, False, None, None, None, None, None, None, 1.0)

def incremental_outlier_removal(pt0, pt1, iterations, config):
    ###################################################################
    #Find the points that should be removed to get the best mean error#
    ###################################################################
    #pt0 and pt1 should be [idx, x, y] so we can keep track of the 
    #final indices of the best points
    for i in range(iterations):
        #Pass the xy coordinates
        new_error, idx = get_LMEDS_error(pt0[:,1:], pt1[:,1:], config)
        idx_to_keep = idx[:-1]
        pt0, pt1 = pt0[idx_to_keep], pt1[idx_to_keep]
    return pt0[:,0].astype(np.int32) #Return the indices
        
def full_outlier_function(pt0, pt1, maximum_removals, config):
    ################################################################
    #Compute the mean reprojection error when we iteratively remove#
    #the biggest outlier from the original set of keypoints        #
    ################################################################
    #We assume that the images are non-planar and that the most planar points will show the lowest mean error, so we
    #try to exclude outlier points based on median error with the expectation that those points will tend to be the most
    #non planar points.
    #There should be a balance between having a high number of points to keep mean error low and removing
    #points that shift inconsistently with the other points so that the total error is low 
    error_array = [] #keep track of the outliers removed and mean error
    for i in range(0 , maximum_removals + 1):
        new_error, idx = get_LMEDS_error(pt0, pt1, config)
        if new_error == None:
            #If the homography cannot be found, stop the search
            return np.array(error_array)
        error_array.append([i, new_error])
        idx_to_keep = idx[:-1] #Drop the point with the highest error
        pt0, pt1 = pt0[idx_to_keep], pt1[idx_to_keep] #Re-run with the new points
    return np.array(error_array)

def get_LMEDS_error(kp0, kp1, config):
    ######################################################
    #Return the points ranked by their reprojection error#
    ######################################################
    #Calculate the optimal homography matrix using Least Median Robust Method
    #We expect that the median error will be minimized when excluding the most
    #non-planar point, which should have the highest reprojection error
    H_LMEDS, _LMEDS = cv2.findHomography(kp0, kp1, cv2.LMEDS)
    if H_LMEDS is None:
        #We assume that if no homography matrix can be found, there are already
        #too few points and we can stop searching
        return None, np.arange(len(kp0))
    else:
        #Calculate reprojection error as pixel distance between projected and dst
        pts = kp0.reshape(-1, 1, 2)
        transformed = cv2.perspectiveTransform(pts, H_LMEDS).reshape(-1, 2)
        difference = kp1 - transformed
        error = np.linalg.norm(difference, axis = 1)
        idx = np.argsort(error) #Return the sorted IDs of keypoints from best to worst
        return np.mean(error), idx

def check_forward_matches(img_matches, img_feats, img_paths, src_idx, config):
    ##############################################
    #Check  images starting with far images first#
    ###############################################
    for dst_idx in range(src_idx + config["forward_limit"], src_idx, -1):
        if len(img_paths) > dst_idx:
            ###################################
            #Match images based on constraints#
            ###################################
            img_feats, matched, kps, fs, kpd, fd, error, ransac, keypoint_prop = get_inliers(img_feats, img_paths,
                                                                                            src_idx, dst_idx, config)
            ###############################################
            #Save keypoints and features for use in OpenCV#
            ###############################################
            if matched:
                config["logger"].debug("Succesfully matched image {} and {}".format(src_idx, dst_idx))
                img_matches[src_idx]['keypoints']['src'] = [keypoint for keypoint in kps.tolist()]
                img_matches[src_idx]['features']['src'] = [feature for feature in fs.tolist()]
                img_matches[dst_idx]['keypoints']['dst'] = [keypoint for keypoint in kpd.tolist()]
                img_matches[dst_idx]['features']['dst'] = [feature for feature in fd.tolist()]
                return img_matches, img_feats, dst_idx, ransac
    raise ValueError("Could not find a match with ", src_idx, " try lowering min_inliers, extracting more frames, or increasing forward_limit")

def find_matching_images(img_paths, start_idx, config):
    ##########################################################
    #Using features extracted from SuperPoint, use LightGlue #
    #to find the minimum set of images that can be stitched  #
    # at high confidence and connect the first and last image#
    ##########################################################
    #A dictionary to hold matching src and dst keypoints and features between images
    img_matches = {}
    for i in range(start_idx, len(img_paths)):
        img_matches[i] = {'keypoints': {'src': [], 'dst': []}, 'features': {'src': [], 'dst': []}}
    src_idx, dst_idx = start_idx, start_idx
    image_subset = [start_idx]
    
    #A dictionary to hold pointers to feature tensors extracted on GPU (or RAM), we avoid extracting the features from all images
    #because we ideally use as few images as possible
    img_feats = {}
    filtered = True #We keep track of whether the matcher had to default to using the raw keypoints for at least one of the images
    while src_idx < len(img_paths) - 1 and len(image_subset) < config["batch_size"]:
        #Only add keypoints and features to the dictionary if they are the best match for that image
        img_matches, img_feats, dst_idx, ransac = check_forward_matches(img_matches, img_feats, img_paths, src_idx, config)
        if ransac is None:
            filtered = False
        src_idx = dst_idx
        image_subset.append(dst_idx)
    return img_matches, image_subset, filtered

def build_feature_objects(subset_image_paths, img_matches, subset_indices, config):
    ##############################################################################
    #Convert the preselected SuperPoint keypoint and features into OpenCV objects#
    ##############################################################################
    cv_features = []
    dummy_img = read_image(subset_image_paths[0], config) #load first image as a dummy

    #We pass dummy images since we are manually setting the info
    for idx in subset_indices:
        feat = cv2.detail.computeImageFeatures2(cv2.ORB.create(), dummy_img)
        keypoints = np.array(img_matches[idx]['keypoints']['src'] + img_matches[idx]['keypoints']['dst'])
        feat.keypoints = tuple(cv2.KeyPoint(keypoints[x, 0], keypoints[x, 1], 0.0) for x in range(len(keypoints)))
        feat.descriptors = cv2.UMat(np.array(img_matches[idx]['features']['src'] + img_matches[idx]['features']['dst'], dtype = np.float32))
        cv_features.append(feat)
    return cv_features

def subset_images(image_paths, start_idx, config):
    ##################################
    #Find best matches between images#
    ##################################
    img_matches, subset_indices, filtered = find_matching_images(image_paths, start_idx, config)

    ###########################################################################
    #Use the matched images and keypoints to create the OpenCV feature objects#
    ###########################################################################
    subset_image_paths = [image_paths[i] for i in subset_indices]
    cv_features = build_feature_objects(subset_image_paths, img_matches, subset_indices, config)
    return cv_features, subset_indices, img_matches, filtered

def OpenCV_match(cv_features, config):
    ############################
    #Calculate pairwise matches#
    ############################
    pairs = itertools.product(range(len(cv_features)), range(len(cv_features)))
    matches = []
    #Since we only want subsequent images matched, we only calculate matches between images and
    #the previous or next image, the other pairwise matches are set to have no matches
    #to prevent mismatches across images.
    for i, j in pairs:
        if abs(j - i) > 1 or i == j:
            match = cv2.detail.MatchesInfo()
            if i == j:
                #This matches convention of cv matching of self to self
                match.src_img_idx, match.dst_img_idx = -1, -1
            else:
                match.src_img_idx, match.dst_img_idx = i, j
            match.H = np.zeros((0, 0), dtype=np.float64)
            match.confidence = 0.0
            match.inliers_mask = np.array([], dtype=np.uint8)
            match.num_inliers = 0
            match.matches = []
        else:
            #One issue is that the OpenCV matcher is not as good as the LightGlue one, so even though
            #we handpick keypoints and features that we know are good matches, it will not always
            #recognize that. This matcher uses Lowe's ratio test, where a low match_conf will allow more
            #points (I think this is a poor implementation or the documentation is wrong?).
            #If confident in the matches, set match_conf low to avoid excluding true matches, default is 0.3.
            matcher = cv2.detail.BestOf2NearestMatcher(try_use_gpu = False, match_conf = 0.1,
                                                         num_matches_thresh1 = 6, num_matches_thresh2 = 6,
                                                           matches_confindece_thresh = 3.0)
            #apply2 finds all pairwise matches and is accelerated by TBB, but we can beat that performance
            #serially by simply skipping most pairs
            match = matcher.apply(cv_features[i], cv_features[j])
            if match.confidence <= 0.1:
                config["logger"].debug("Match {} and {} in this batch were too similar, changing to affine matcher".format(i, j))
                #matches_confidece_thresh (sic) is the threshold over which a match is 
                #considered a match, default is 3.0. In source if match confidence is > thresh, confidence is set to zero,
                #where confidence is inliers / (8 + 0.3 * matches). This is meant to reject images that are too similar.
                #Since this is not a problem for this implementation, we increase the threshold if there is failure based
                #on matches being too good. Unfortunately, it seems like this parameter cannot be set in the source and 3.0 is
                #used regardless? This is commented out in the affine matcher, so we switch to the affine matcher if 
                #the normal matcher return a confidence of 0.
                matcher = cv2.detail_AffineBestOf2NearestMatcher(try_use_gpu = False, match_conf = 0.1,
                                                             num_matches_thresh1 = 6)
                match = matcher.apply(cv_features[i], cv_features[j])
            match.src_img_idx, match.dst_img_idx = i, j
        matches.append(match)
    return matches

def prepare_OpenCV_objects(start_idx, config):
    ###############################################################################
    #Get the features for the best subset of images using SuperPoint and LightGlue#
    ###############################################################################
    cv_features, subset_indices, img_matches, filtered = subset_images(config["image_paths"], start_idx, config)
    matches = OpenCV_match(cv_features, config)

    #######################################################################
    #Make list of the subset of images used and resize to final resolution#
    #######################################################################
    images = [read_image(config["image_paths"][i], config) for i in subset_indices]
    subset_image_names = [config["image_names"][i] for i in subset_indices]
    
    ########################################################################################
    #Make a dictionary with the src and dst keypoints and features for the subset of images#
    ########################################################################################
    subset_img_keypoints = {i: img_matches[k]['keypoints'] for i, k in enumerate(subset_indices)}
    if subset_indices[-1] >= len(config["image_paths"]) - 1:
        finished = True
    else:
        finished = False
    return images, cv_features, matches, subset_img_keypoints, subset_indices[-1], filtered, finished, subset_image_names

def spherical_OpenCV_pipeline(images, features, matches, config):
    #############################################################################################
    #Process images assuming that the camera is stationary and rotating.                        #
    #Then project the images onto a sphere. The bundle adjustment process becomes               #
    #too computationally intensive (and unconstrained) when applied to a large number of images.#
    #However, the rotational DOF allow for high quality mostly planar projections for small     #
    #batches of images even when the camera is translating.                                     #
    #############################################################################################
    cameras = spherical_camera_estimation(features, matches, config)
    processed_images = spherical_warp_images(images, cameras, config)
    processed_images = get_seams(*processed_images)
    panorama, corners, sizes = blend_images(*processed_images)
    return panorama, corners, sizes

def bundle_affine_OpenCV_pipeline(images, features, matches, config):
    ############################################################################################
    #Process images assuming that the camera can translate and rotate.                         #
    #The OpenCV bundle adjustment procedure can lead to worse results                          #
    #because it uses the features and matched keypoints to try to find the                     #
    #camera positions that minimize error, but are thus prone to undoing the filtering process #
    #Since the behavior is unpredictable, this is not a recommended.                           #
    ############################################################################################
    cameras = affine_camera_adjustment(features, matches, config)
    processed_images = affine_warp_images(images, cameras, config)
    processed_images = get_seams(*processed_images)
    panorama, corners, sizes = blend_images(*processed_images)
    return panorama, corners, sizes

def affine_OpenCV_pipeline(images, keypoint_dict, translation_only, config):
    #########################################################################
    #Process images assuming that the camera can translate and rotate.      #
    #We calculate the affine transform directly from the keypoints and then #
    #use OpenCV for the seams and blending. Since there is no bundle        #
    #adjustment, the run time should be manageable and the results should be# 
    #stable as long as the matches are good.                                #
    #########################################################################
    if translation_only:
        cameras = estimate_translation_cameras(keypoint_dict, config)
    else:
        cameras = estimate_cameras(keypoint_dict, config)
    processed_images = affine_warp_images(images, cameras, config)
    processed_images = get_seams(*processed_images)
    panorama, corners, sizes = blend_images(*processed_images)
    return panorama, corners, sizes

def spherical_camera_estimation(features, matches, config):
    ###########################################################################
    #Estimate camera rotations and focal length (can change across cameras),  #
    #with principalx and principaly constant across cameras and no translation#
    ###########################################################################
    
    #On Linux systems we get a persistent warning when the cameras cannot be estimated because of a nan or inf:
    #DLASCLS parameter number 4 had an illegal value on Linux systems
    estimator = cv2.detail_HomographyBasedEstimator()
    success, cameras = estimator.apply(features, matches, None)
    if not success:
        raise ValueError("Failed to estimate cameras")
        
    #Change types to match what bundleAdjuster wants and try to check for bad camera estimates
    for cam in cameras:
        camera_vector_magnitude = np.linalg.norm(np.matmul(cam.R, np.array([0, 0, 1])))
        if (cam.R[2,2] < 0.1 or cam.focal < 0) or (camera_vector_magnitude > 2.5):
            raise ValueError("Invalid camera estimate")
        cam.R = cam.R.astype(np.float32)
        
    adjuster = cv2.detail_BundleAdjusterRay()
    #Having a low threshold helps force the cameras to keep the matches we want,
    #we assume that this is preferable to OpenCV trying to reject some of our image matches
    adjuster.setConfThresh(0.1)
    success, cameras = adjuster.apply(features, matches, cameras)
    if not success:
        raise ValueError("Failed to adjust cameras")
        
    #To help maintain straighter panoramas, use wave correction to help account for
    #the camera angle changing and not being normal to the ground
    wave_direction = cv2.detail.WAVE_CORRECT_HORIZ
    rotation_matrices = [np.copy(cam.R) for cam in cameras]
    rotation_matrices = cv2.detail.waveCorrect(rotation_matrices, wave_direction)
    for i, cam in enumerate(cameras):
        #The camera axis is the z, so we want the local z to global z to have movement in the 
        #y direction and primarily movement in the x direction, but if it gets too oblique,
        #it will probably be weird. The z-coordinate should also never be negative.
        camera_vector = np.abs(np.matmul(cam.R, np.array([0, 0, 1])))
        if (abs(camera_vector[1]) > 0.5) or (camera_vector[2] < 0.1) :
            raise ValueError("Invalid camera adjustment")
        else:
            cam.R = rotation_matrices[i]
    return cameras

def spherical_warper(original_img, camera, scale, aspect_ratio, config):
    ##########################################################################
    #Project images onto a sphere assuming a stationary camera with rotations#
    #and variable focal length                                               #
    ##########################################################################
    warper = cv2.PyRotationWarper("spherical", scale*aspect_ratio)
    w, h = original_img.shape[1], original_img.shape[0]
    K = camera.K().astype(np.float32)
    K[0, 0] *= aspect_ratio
    K[0, 2] *= aspect_ratio
    K[1, 1] *= aspect_ratio
    K[1, 2] *= aspect_ratio
    roi  = warper.warpRoi((w, h), K = K, R = camera.R) #returns (top_leftx, top_lefty, sizex, sizey)
    if roi[2] > 3* config["img_dims"][0] or roi[3] > 3* config["img_dims"][1]:
        raise ValueError("Invalid scale in warp")
    top_left, warped = warper.warp(original_img, K = K, R = camera.R,
                      interp_mode = cv2.INTER_LINEAR, border_mode = cv2.BORDER_REFLECT)
    #Create a black and white mask of the warped image for cropping, finding seams, and blending
    mask = 255 * np.ones((h, w), np.uint8)
    top_left, mask = warper.warp(mask, K = K, R = camera.R,
                      interp_mode = cv2.INTER_NEAREST, border_mode = cv2.BORDER_CONSTANT)
    return warped, mask, roi[0:2], roi[2:4]

def spherical_warp_images(images, cameras, config):
    ###################################################################
    #Warp images, find the position of their top left corners         #
    #in the final global coordinates, and create masks for the images.#
    ###################################################################
    #Focal distance has to be accounted for as this is a scale parameter that
    #interacts with the camera aspect (which will change based on resolution)
    scale = np.median([cam.focal for cam in cameras])
    warped_final_imgs = []
    warped_final_masks = []
    final_corners = []
    final_sizes = []
    camera_aspect = 1.0
    for img, camera in zip(images, cameras):
        warped_img, warped_mask, corner, size = spherical_warper(img, camera, scale, camera_aspect, config)
        warped_final_imgs.append(warped_img)
        warped_final_masks.append(warped_mask)
        final_corners.append(corner)
        final_sizes.append(size)
    #We create low resolution versions for seam finding
    warped_low_imgs = []
    warped_low_masks = []
    low_corners = []
    low_sizes = []
    low_imgs = [cv2.resize(img, dsize = None, fx = config["seam_resolution"], fy = config["seam_resolution"]) for img in images]
    downscale_aspect_ratio = config["seam_resolution"]
    for img, camera in zip(low_imgs, cameras):
        warped_img, warped_mask, corner, size = spherical_warper(img, camera, scale, downscale_aspect_ratio, config)
        warped_low_imgs.append(warped_img)
        warped_low_masks.append(warped_mask)
        low_corners.append(corner)
        low_sizes.append(size)
    return (warped_low_imgs, warped_low_masks, low_corners, low_sizes,
            warped_final_imgs, warped_final_masks, final_corners, final_sizes)

def affine_camera_adjustment(features, matches, config):
    ####################################################################
    #Estimate and adjust affine matrices in global coordinate          # 
    #using bundle adjustment. Since bundle adjustment is a complicated #
    #global minimization problem, this becomes unstable when there are #
    #many images. The process uses the features and matches to optimize#
    #transformations, but since it ignores the constraints we enforced #
    #upstream, it can exhibit poor behavior.                           #
    ####################################################################
    #Estimates affine transforms from matches and features
    estimator = cv2.detail_AffineBasedEstimator()
    success, cameras = estimator.apply(features, matches, None)
    if not success:
        raise ValueError("Failed to estimate cameras")
    #change types to match what bundleAdjuster wants
    for cam in cameras:
        cam.R = cam.R.astype(np.float32)
    #Changing confidence threshold may help adjustment if the optimization is difficult 
    #and fails. It should be easier if there is high confidence between subsequent images
    #and the correct adjustment (affine or spherical) is chosen. Lower the confidence threshold
    #to pass adjustment, but adjustment might be more error prone.
    adjuster = cv2.detail_BundleAdjusterAffinePartial()
    # adjuster = cv2.detail_BundleAdjusterAffinePartial() #removes shearing
    adjuster.setConfThresh(0.1)
    success, cameras =adjuster.apply(features, matches, cameras)
    if not success:
        raise ValueError("Failed to adjust cameras")
    return cameras

def estimate_cameras(keypoint_dict, config):
    ##########################################################
    #Use the keypoints to recalculate transformation matrices#
    #according to the camera option chosen in congfig.       #
    ##########################################################
    #First estimate the partial affine matrix between subsequent images
    #using LMEDS. Since the points have already been filtered with RANSAC
    #and the LMEDS outlier removal, we assume that the LMEDS estimate
    #will be stable.
    num_images = len(keypoint_dict)
    H_pairs = [] #homography matrix from src to dst for subsequent images
    for src, dst in [(i, i+1) for i in range(num_images - 1)]:
        kp0 = np.array(keypoint_dict[src]['src'], dtype = np.int64)
        kp1 = np.array(keypoint_dict[dst]['dst'], dtype = np.int64)
        
        ###############################
        #Get partial affine homography#
        ###############################
        #Partial affine transformations are the most stable and are recommended
        H_LMEDS, _LMEDS = cv2.estimateAffinePartial2D(kp0, kp1, cv2.LMEDS)
        H_LMEDS = np.vstack((H_LMEDS, np.array([0, 0, 1])))
        H_pairs.append(H_LMEDS)
    
    #########################
    #Build global homography#
    #########################
    #Now choose the middle image as a reference image and convert the transformation
    #matrices to be with resepct to the reference to create global coordinates.
    H_list = []
    middle_idx = num_images//2 #Use middle image as the reference image
    for i in range(num_images):
        H_to_middle = np.array([[1.0, 0.0, 0.0],
                               [0.0, 1.0, 0.0],
                               [0.0, 0.0, 1.0]])
        #Build matrix to get to middle image for ith image
        if i < middle_idx:
            for m in range(middle_idx - 1, i - 1, -1):
            #Need to get inverse since the H is dst->src and going away from middle image
                H_to_middle = np.matmul(H_to_middle, np.linalg.inv(H_pairs[m]))
            H_list.append(H_to_middle)
        elif i == middle_idx:
            H_list.append(H_to_middle)
        else:
            for m in range(middle_idx, i, 1):
            #Keep H as is since dst ->src gets us towards middle image
                H_to_middle = np.matmul(H_to_middle, H_pairs[m])
            H_list.append(H_to_middle)
            
    ##################################################
    #Save the homography matrices as camera rotations#
    ##################################################
    #This allows us to use OpenCV functions in the future
    cameras = []
    for c in range(num_images):
        cam = cv2.detail.CameraParams()
        cam.R = H_list[c].astype(np.float32)
        cameras.append(cam)
    return cameras

def estimate_translation_cameras(keypoint_dict, config):
    ##########################################################
    #Use the keypoints to recalculate transformation matrices#
    #according to the camera option chosen in congfig.       #
    ##########################################################
    #First estimate the partial affine matrix between subsequent images
    #using LMEDS. Since the points have already been filtered with RANSAC
    #and the LMEDS outlier removal, we assume that the LMEDS estimate
    #will be stable.
    num_images = len(keypoint_dict)
    H_pairs = [] #homography matrix from src to dst for subsequent images
    for src, dst in [(i, i+1) for i in range(num_images - 1)]:
        kp0 = np.array(keypoint_dict[src]['src'], dtype = np.int64)
        kp1 = np.array(keypoint_dict[dst]['dst'], dtype = np.int64)
        H_LMEDS, _LMEDS = cv2.estimateAffinePartial2D(kp0, kp1, cv2.LMEDS)
        transx = H_LMEDS[0, 2]
        transy = H_LMEDS[1, 2]
        #We only keep the translations and assume that the scales should be
        #approximately the same because the median scale for each panorama
        #should be about the same
        reduced = np.array([[1, 0, transx],
                            [0, 1, transy]])
        H_LMEDS = np.vstack((reduced, np.array([0, 0, 1])))
        H_pairs.append(H_LMEDS)
        
    #########################
    #Build global homography#
    #########################
    #Now choose the middle image as a reference image and convert the transformation
    #matrices to be with resepct to the reference to create global coordinates.
    H_list = []
    middle_idx = num_images//2 #Use middle image as the reference image
    for i in range(num_images):
        H_to_middle = np.array([[1.0, 0.0, 0.0],
                               [0.0, 1.0, 0.0],
                               [0.0, 0.0, 1.0]])
        #Build matrix to get to middle image for ith image
        if i < middle_idx:
            for m in range(middle_idx - 1, i - 1, -1):
            #Need to get inverse since the H is dst->src and going away from middle image
                H_to_middle = np.matmul(H_to_middle, np.linalg.inv(H_pairs[m]))
            H_list.append(H_to_middle)
        elif i == middle_idx:
            H_list.append(H_to_middle)
        else:
            for m in range(middle_idx, i, 1):
            #Keep H as is since dst ->src gets us towards middle image
                H_to_middle = np.matmul(H_to_middle, H_pairs[m])
            H_list.append(H_to_middle)
            
    ##################################################
    #Save the homography matrices as camera rotations#
    ##################################################
    #This allows us to use OpenCV functions in the future
    cameras = []
    for c in range(num_images):
        cam = cv2.detail.CameraParams()
        cam.R = H_list[c].astype(np.float32)
        cameras.append(cam)
    return cameras

def affine_warp_images(images, cameras, config):
    ##################################################################################################
    #Get the transformed images and their masks as well as their start corners in global coordinates.#
    #Repeat for low resolution images so processing is easier downstream                             #
    ##################################################################################################
    #First work on the final resolution
    warped_final_imgs = []
    warped_final_masks = []
    final_corners = []
    final_sizes = []
    camera_aspect = 1.0
    for img, camera in zip(images, cameras):
        warped_img, warped_mask, corner, size = affine_warper(img, camera, camera_aspect)
        warped_final_imgs.append(warped_img)
        warped_final_masks.append(warped_mask)
        final_corners.append(corner)
        final_sizes.append(size)
    #We create low resolution versions for seam finding but scale the transformation matrix
    #directly to downscale the images rather than resize and then warp them
    warped_low_imgs = []
    warped_low_masks = []
    low_corners = []
    low_sizes = []
    downscale_aspect_ratio = config["seam_resolution"]
    for img, camera in zip(images, cameras):
        warped_img, warped_mask, corner, size = affine_warper(img, camera, downscale_aspect_ratio)
        warped_low_imgs.append(warped_img)
        warped_low_masks.append(warped_mask)
        low_corners.append(corner)
        low_sizes.append(size)
    return (warped_low_imgs, warped_low_masks, low_corners, low_sizes,
            warped_final_imgs, warped_final_masks, final_corners, final_sizes)

def warpROI(original_img, camera, aspect_ratio):
    ##################################################################
    #Find top left corner of warped image in global coordinates      #
    #and return the homography matrix adjusted into local coordinates#
    ##################################################################
    H = np.linalg.inv(camera.R) * aspect_ratio
    w, h = original_img.shape[1], original_img.shape[0]
    x, y = 0, 0
    #Corners (top left, bottom left, top right, bottom right) of original image in local coordinates
    corners = np.array([[x, y, 1], [x, y + h - 1, 1], [x + w - 1, y, 1], [x + w - 1, y + h - 1, 1]])
    top_left = np.floor(np.matmul(H, corners[0])[:2])
    bottom_left = np.floor(np.matmul(H, corners[1])[:2])
    top_right = np.floor(np.matmul(H, corners[2])[:2])
    bottom_right =  np.floor(np.matmul(H, corners[3])[:2])
    scaled_corners = np.array([top_left, bottom_left, top_right, bottom_right])
    minx, miny = np.min(scaled_corners[:, 0]), np.min(scaled_corners[:, 1])
    #Get the dimensions of the rectangular bounding box of the warped image, the top left corner of the bounding box is minx, miny
    global_top_left = (int(minx), int(miny)) 
    #Now remove the global translation from the homography matrix to make the homography in place
    T = np.array([[1, 0, -minx/H[2, 2]], [0, 1, -miny/H[2, 2]], [0, 0, 1]])
    H_global_adj = T.dot(H) #This has the global translation of the top left corner removed
    return global_top_left, H_global_adj

def affine_warper(original_img, camera, aspect_ratio):
    ###############################################################################
    #Warp image in local coordinates and the top left corner in global coordinates#
    ###############################################################################
    #Get top left corner of the warped image for global placement
    pos, H = warpROI(original_img, camera, aspect_ratio)
    w, h = original_img.shape[1], original_img.shape[0]
    x, y = 0, 0
    #Corners (top left, bottom left, top right, bottom right) of original image in local coordinates
    corners = np.array([[x, y, 1], [x, y + h - 1, 1], [x + w - 1, y, 1], [x + w - 1, y + h - 1, 1]])
    #Now we need to adjust the homography matrix again to translate the image to make sure 
    #all points are positive
    top_left = np.floor(np.matmul(H, corners[0])[:2])
    bottom_left = np.floor(np.matmul(H, corners[1])[:2])
    top_right = np.floor(np.matmul(H, corners[2])[:2])
    bottom_right =  np.floor(np.matmul(H, corners[3])[:2])
    scaled_corners = np.array([top_left, bottom_left, top_right, bottom_right])
    minx, miny = np.min(scaled_corners[:, 0]), np.min(scaled_corners[:, 1])
    maxx, maxy = np.max(scaled_corners[:, 0]), np.max(scaled_corners[:, 1])
    width = int(np.ceil(maxx - minx))
    height = int(np.ceil(maxy - miny))
    local_x_translation = int(-minx if minx < 0 else 0)
    local_y_translation = int(-miny if miny < 0 else 0)
    T = np.array([[1, 0, local_x_translation/H[2, 2]], [0, 1, local_y_translation/H[2, 2]], [0, 0, 1]])
    H_local_adj = T.dot(H)
    #This allows us to scale the image by aspect ratio with warpPerspective rather than generating the image at a lower resolution,
    #since everything else will be scaled by the aspect_ratio
    H_local_adj[2, 2] = 1 
    #Use warpPerspective with dst image to avoid potential memory leak when using dst = cv2.warpPerspective()
    warped = np.zeros((height, width, original_img.shape[2]), dtype = np.uint8)
    cv2.warpPerspective(original_img, H_local_adj, (width, height), warped, cv2.INTER_LINEAR)
    #Create a black and white mask for the warped image to help with stitching
    mask = 255 * np.ones((h, w), np.uint8)
    warped_mask = np.zeros((height, width), dtype = np.uint8)
    cv2.warpPerspective(mask, H_local_adj, (width, height), warped_mask, cv2.INTER_NEAREST)
    return warped, warped_mask, pos, (width, height)

def get_seams(low_imgs, low_masks, low_corners, low_sizes,
              final_imgs, final_masks, final_corners, final_sizes):
    #######################################################################################
    #Find seams in overlapping areas and compensate the images for differences in exposure#
    #######################################################################################
    #Colorgrad outperforms default color option, for higher resolution images seams are more aggressive
    #and more image is lost, colorgrad helps eliminate duplication without losing too much image
    seam_finder = cv2.detail_DpSeamFinder("COLOR_GRAD")
    imgs = [img.astype(np.float32) for img in low_imgs]
    seam_masks = seam_finder.find(imgs, low_corners, low_masks)
    resized_seam_masks = [cv2.resize(seam_mask, (final_mask.shape[1], final_mask.shape[0]), 0, 0, cv2.INTER_LINEAR_EXACT)
                          for seam_mask, final_mask in zip(seam_masks, final_masks)]
    final_seam_masks = [cv2.bitwise_and(resized_seam_mask, final_mask)
                        for resized_seam_mask, final_mask in zip(resized_seam_masks, final_masks)]
    return final_seam_masks, final_imgs, final_corners, final_sizes

def blend_images(seam_masks, imgs, final_corners, final_sizes, blend_strength = 5):
    ###################################
    #Blend images together using seams#
    ###################################
    #Band number taken from open stitching 
    dst_sz = cv2.detail.resultRoi(corners = final_corners, sizes = final_sizes)
    blend_width = np.sqrt(dst_sz[2] * dst_sz[3]) * blend_strength / 100
    blender = cv2.detail_MultiBandBlender()
    blender.setNumBands(int((np.log(blend_width) / np.log(2.0) - 1.0)))
    blender.prepare(dst_sz)
    for img, mask, corner in zip(imgs, seam_masks, final_corners):
        blender.feed(cv2.UMat(img.astype(np.int16)), mask, corner)
    blended, mask = blender.blend(None, None)
    panorama = cv2.convertScaleAbs(blended)
    
    #Shift corner positions to be positive since the corners are currently centered
    #on the middle image with top left corner 0,0 -- now in final global coordindates
    positive_corners = np.array(final_corners, dtype = np.float64)
    positive_corners = positive_corners - np.array([np.min(positive_corners[:,0]), np.min(positive_corners[:, 1])])
    return panorama, positive_corners, np.array(final_sizes)

def threshold_image(image, threshold_value, pad):
    ####################################################
    #Threshold a color BGR image to black and white and#
    #keep only the largest connected component         #
    ####################################################
    imgray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    
    #We need to specify a threshold value because blending can cause
    #some non-black pixels that should be treated as black
    ret, thresh = cv2.threshold(imgray, threshold_value, 255, 0) #separate black from non-black pixels
    thresh = cv2.copyMakeBorder(thresh, pad, pad, pad, pad, cv2.BORDER_CONSTANT) #add padding for corner finding
    output = cv2.connectedComponentsWithStats(thresh, 8, cv2.CV_32S)
    if output[0] > 1:
        largest_object = np.max(output[2][1:, cv2.CC_STAT_AREA])
        remove_labels = np.where(output[2][:, cv2.CC_STAT_AREA] < largest_object)[0]
    else:
        remove_labels = None
    thresh = output[1]
    thresh[np.isin(thresh, remove_labels)] = 0
    thresh[thresh > 0] = 255
    return np.uint8(thresh)

def check_panorama(panorama, config):
    ####################################
    #Test for a major stitching failure#
    ####################################
    #Threshold the panorama to check its shape, we add a pad around it for corner finding
    thresh = threshold_image(panorama, 0, 10)
    
    ##################
    #Check dimensions#
    ##################
    #Since we do not have an expectation for the distance traveled by the camera, but we 
    #assume that the camera has minimal rotation, the dimension of the panorama in the non-stitching direction
    #should be relatively constant. If the maximum/median value is to high, we assume there was a poor
    #stitch
    dim = np.sum(thresh, axis = 0)
    dim_ratio = np.max(dim)/np.median(dim)
    
    #######################################
    #Check if panorama has high distortion#
    #######################################
    #The corners of the panorama should make the shape of a rectangle
    #If the vertical edges are much different in length, there was some distortion
    #when making planar, so check if the corners form a rhombus
    try:
        (top_left, top_right, bottom_right, bottom_left) = find_pano_corners(thresh, config)
        top_length = top_right[0] - top_left[0]
        bottom_length = bottom_right[0] - bottom_left[0]
        left_height = bottom_left[1] - top_left[1]
        right_height = bottom_right[1] - top_right[1]
        #Check if the left edge is angled too much, which may make stitching to the next batch hard
        left_edge_slope = abs((top_left[1] - bottom_left[1])/((top_left[0] - bottom_left[0] + 0.01)))
        if top_length <= bottom_length:
            top_rhombus = top_length/bottom_length
        else:
            top_rhombus = bottom_length/top_length
        if left_height <= right_height:
            side_rhombus = left_height/right_height
        else:
            side_rhombus = right_height/left_height
        rhombus = min(top_rhombus, side_rhombus)
    except Exception as e:
        config["logger"].warning(e)
        config["logger"].warning("Could not find corners of batch")
        rhombus = 0.0
        
    ############################
    #Check if panorama has gaps#
    ############################
    #We assume panorama should consist of a single continuous image, so if there
    #are multiple contours (the image consists of multiple continuous images),
    #the panorama has failed.
    contours, hierarchy = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    
    ##############################################
    #Report whether the panorama passed the check#
    ##############################################
    if len(contours) == 1 and (dim_ratio <= 1.5 and rhombus >= 0.67):
        """"IN FUTURE USE THIS CHECK TO CHANGE START IDX OF NEXT BATCH"""
        if left_edge_slope <= 1:
            return True
        else:
            return True
    else:
        if len(contours) > 1.0:
            config["logger"].info("Panorama is not continuous!")
        if dim_ratio > 1.5:
            config["logger"].info("Dimensions of panorama are concerning")
        #1:1.5 ratio threshold for lengths to check for distortion
        if rhombus < 0.67:
            config["logger"].info("Panorama seems distorted")
        return False

def retry_panorama(start_idx, filtered, config):
    ##############################################################
    #If a panorama cannot be created we try to adjust settings to# 
    #successfully generate the panorama                          #
    ##############################################################
    if not filtered:
        #################################################################
        #If the panorama was not filtered, it means that the constraints# 
        #imposed on the homography could not be met, so we try to relax #
        #those constraints to maintain some filter on the points        #
        #################################################################
        config["logger"].info("Retrying with relaxed error and inlier constraints...")
        config["max_reprojection_error"] *= 1.2
        config["min_inliers"] *= 0.8
        config["max_RANSAC_thresh"] *= 1.2
        config["scale_constraint"] *= 1.2
        config["xy_ratio"] *= 0.8
        images, cv_features, matches, keypoint_dict, idx, filtered, finished, subset_image_names = prepare_OpenCV_objects(start_idx, config)
        
        #If a spherical stitch is not possible, try with a partial affine stitch instead
        if config["camera"] == "spherical":
            try:
                new_panorama, corners, sizes = spherical_OpenCV_pipeline(images, cv_features, matches, config)
                if not check_panorama(new_panorama, config):
                    config["logger"].warning(
                        "Spherical stitching was unreliable for batch {},retrying with partial affine... consider reducing forward_limit or batch_size".format(idx))
                    new_panorama, corners, sizes = affine_OpenCV_pipeline(images, keypoint_dict, False, config)
            except ValueError as e:
                config["logger"].warning(e)
                config["logger"].warning(
                    "Spherical stitching failed for batch {}, retrying with partial affine... consider reducing forward_limit or batch_size".format(idx))
                new_panorama, corners, sizes = affine_OpenCV_pipeline(images, keypoint_dict, False, config)
        else:
            new_panorama, corners, sizes = affine_OpenCV_pipeline(images, keypoint_dict, False, config)
        #Return parameters to original values since the dictionary is modified in place
        config["max_reprojection_error"] /= 1.2
        config["min_inliers"] /= 0.8
        config["max_RANSAC_thresh"] /= 1.2
        config["scale_constraint"] /= 1.2
        config["xy_ratio"] /= 0.8
        
    else:
        ##########################################################################
        #If the panorama was filtered, it means that the constraints were met,   #
        #so we tighten the constraints to try to remove outliers that could cause#
        #a stitching failure                                                     #
        ##########################################################################
        config["logger"].info("Panorama is unreliable, retrying with stronger error and inlier constraints...")
        config["max_reprojection_error"] *= 0.8
        config["min_inliers"] *= 1.2
        config["max_RANSAC_thresh"] *= 0.8
        config["scale_constraint"] *= 0.8
        config["xy_ratio"] *= 1.2
        images, cv_features, matches, keypoint_dict, idx, filtered, finished, subset_image_names = prepare_OpenCV_objects(start_idx, config)
        #If a spherical stitch is not possible, try with a partial affine stitch instead
        if config["camera"] == "spherical":
            try:
                new_panorama, corners, sizes = spherical_OpenCV_pipeline(images, cv_features, matches, config)
                if not check_panorama(new_panorama, config):
                    config["logger"].warning(
                        "Spherical stitching was unreliable for batch {}, retrying with partial affine... consider reducing forward_limit or batch_size".format(idx))
                    new_panorama, corners, sizes = affine_OpenCV_pipeline(images, keypoint_dict, False, config)
            except ValueError as e:
                config["logger"].warning(e)
                config["logger"].warning(
                    "Spherical stitching failed for batch {}, retrying with partial affine... consider reducing forward_limit or batch_size".format(idx))
                new_panorama, corners, sizes = affine_OpenCV_pipeline(images, keypoint_dict, False, config)
        else:
            new_panorama, corners, sizes = affine_OpenCV_pipeline(images, keypoint_dict, False, config)
        #Return parameters to original values since the dictionary is modified in place
        config["max_reprojection_error"] /= 0.8
        config["min_inliers"] /= 1.2
        config["max_RANSAC_thresh"] /= 0.8
        config["scale_constraint"] /= 0.8
        config["xy_ratio"] /= 1.2
        
    #########################################################
    #Save center position of each image used in the panorama#
    #########################################################
    center_pixels = corners + sizes//2
    batch_dict = {}
    for image_name, position in zip(subset_image_names, center_pixels):
        batch_dict[image_name] = position
    config["registration"][idx] = batch_dict

    ###############################################
    #Check whether the new panorama was successful#
    ###############################################
    if check_panorama(new_panorama, config):
        return new_panorama, idx, finished, len(images)
    else:
        config["logger"].warning("Trying to proceed with a distorted mosaic for batch {}...".format(idx))
        return new_panorama, idx, finished, len(images)

def run_stitching_pipeline(start_idx, config):
    ###############################################################################
    #Create panoramas by taking a subset of the images and stitching them together#
    #when the number of stitched images reaches the batch size                    #
    ###############################################################################
    #Extract the features and matches between the minimal subset of images, which are now ready to be stitched
    config["logger"].info("Starting new batch with image {} ...".format(start_idx))
    images, cv_features, matches, keypoint_dict, idx, filtered, finished, subset_image_names = prepare_OpenCV_objects(start_idx, config)
    
    #########################################################################################
    #Spherical projection works best because of robust bundle adjustment and wave correction#
    #########################################################################################
    #Default to affine if there were no good matches
    if (config["camera"] == "spherical"):
        try: #Since bundle adjustment can fail, we use a try/except statement
            panorama, corners, sizes = spherical_OpenCV_pipeline(images, cv_features, matches, config)
            #If the panorama seems incorrect, use the same keypoints and try with a partial affine projection
            if not check_panorama(panorama, config):
                config["logger"].warning(
                    "Spherical stitching was unreliable for batch {},retrying with partial affine... consider reducing forward_limit or batch_size".format(idx))
                config["camera"] = "partial affine"
                panorama, corners, sizes = affine_OpenCV_pipeline(images, keypoint_dict, False, config)
                config["camera"] = "spherical"
        except ValueError as e: #If bundle adjustment fails, fall back on a partial affine stitch with same keypoints instead
            config["logger"].warning(e)
            config["logger"].warning(
                "Spherical stitching failed for batch {}, retrying with partial affine... consider reducing forward_limit or batch_size".format(idx))
            config["camera"] = "partial affine"
            panorama, corners, sizes = affine_OpenCV_pipeline(images, keypoint_dict, False, config)
            config["camera"] = "spherical"
            
    ##########################################################################################
    #Partial affine recommended for mostly linear camera translation and minimal rotation,   #
    #can fail with many images and does not have bundle adjustment                           #
    #Homography and affine are not recommended because they can make unstable transformations#
    ##########################################################################################
    else:
        panorama, corners, sizes = affine_OpenCV_pipeline(images, keypoint_dict, False, config)
        
    ##############################################################################################
    #Check whether the panorama needs to be attempted again with different keypoints and features#
    ##############################################################################################
    output_filename = 'batch_' + os.path.basename(os.path.normpath(config["image_directory"])) + '.png'
    if check_panorama(panorama, config):
        center_pixels = corners + sizes//2
        batch_dict = {}
        for image_name, position in zip(subset_image_names, center_pixels):
            batch_dict[image_name] = position
        config["registration"][idx] = batch_dict
        image_range = idx - start_idx + 1
        images_used = len(images)
        config["logger"].info("Used {} images of the initial {}".format(images_used, image_range))
        config["logger"].info("Saving image {}".format(idx))
        cv2.imwrite(os.path.join(config["output_path"], str(idx) + "_"  + output_filename), panorama)
        return finished, idx, images_used
    else:
        ##############################################################
        #If the current constraints are unable to produce a panorama,#
        #try with modified constraints                               #
        ##############################################################
        new_panorama, new_idx, new_finished, images_used = retry_panorama(start_idx, filtered, config)
        #Use new panorama
        image_range = new_idx - start_idx + 1
        config["logger"].info("Used {} images of the initial {}".format(images_used, image_range))
        config["logger"].info("Saving image {}".format(new_idx))
        cv2.imwrite(os.path.join(config["output_path"], str(new_idx) + "_"  + output_filename), new_panorama)
        return new_finished, new_idx, images_used

def extract_all_batch_features(images, search_distance, config):
    ##################################################################
    #Use SuperPoint to extract keypoints and features from panoramas#
    #################################################################
    img_feats = {} #Dictionary to store features and keypoints
    for i in range(len(images)):
        img_feats[i] = {'src': [], 'dst': []}
    ##################################################################
    #Crop photo into a src and dst image that are pad pixels long    #
    #in the stitching direction so we can only extract keypoints from#
    #the relevant stitched edges of the panoramas                    #
    ##################################################################
    for i, image in enumerate(images):
        #Crop images using OpenCV index of height, width, but when we get the
        #keypoints back they will be in width, height format
        width = image.shape[1]
        if search_distance >= width:
            src_img = image[:, :, :]
            dst_img = image[:, :, :]
            src_pad_array = np.array([0, 0])
            dst_pad_array = np.array([0, 0])
        else:
            src_img = image[:, :search_distance, :]
            src_pad_array = np.array([0, 0])
            dst_img = image[:, (width - search_distance ):width, :]
            dst_pad_array = np.array([width - search_distance , 0])

        ####################################
        #Use SuperPoint to extract features#
        ####################################
        extractor = SuperPoint(max_num_keypoints=2048).eval().to(config["device"])
        src_image_tensor = transforms.ToTensor()(src_img).to(config["device"]).unsqueeze(0)
        dst_image_tensor = transforms.ToTensor()(dst_img).to(config["device"]).unsqueeze(0)
        with torch.no_grad():
            src_feats = extractor.extract(src_image_tensor)
            src_feats['scores'] = src_feats.get('scores', torch.ones((1, src_feats['keypoints'].shape[1]), device=src_feats['keypoints'].device))
            src_feats = rbd(src_feats)
            src_feats['keypoints'] = src_feats['keypoints'].unsqueeze(0)
            #Now we need to transform the keypoint coordinates to the full panorama coordinates
            src_pad_tensor = torch.from_numpy(np.tile(src_pad_array, (src_feats['keypoints'].shape[1], 1))).to(config["device"])
            src_feats['keypoints'] = torch.add(src_feats['keypoints'], src_pad_tensor)
            src_feats['descriptors'] = src_feats['descriptors'].unsqueeze(0)
            src_feats['keypoint_scores']= src_feats['keypoint_scores']
            dst_feats = extractor.extract(dst_image_tensor)
            dst_feats['scores'] = dst_feats.get('scores', torch.ones((1, dst_feats['keypoints'].shape[1]), device=dst_feats['keypoints'].device))
            dst_feats = rbd(dst_feats)
            dst_feats['keypoints'] = dst_feats['keypoints'].unsqueeze(0)
            #Now we need to transform the keypoint coordinates to the full panorama coordinates
            dst_pad_tensor = torch.from_numpy(np.tile(dst_pad_array, (dst_feats['keypoints'].shape[1], 1))).to(config["device"])
            dst_feats['keypoints'] = torch.add(dst_feats['keypoints'], dst_pad_tensor)
            dst_feats['descriptors'] = dst_feats['descriptors'].unsqueeze(0)
            dst_feats['keypoint_scores'] = dst_feats['keypoint_scores']
        img_feats[i]['src'] = src_feats
        img_feats[i]['dst'] = dst_feats
    return img_feats

def match_batch_features(images, search_distance, config):
    #####################################################################
    #Extract panorama features and then match keypoints across panoramas#
    #####################################################################
    config["logger"].info('Extracting batch features...')
    img_feats = extract_all_batch_features(images, search_distance, config)
    img_match_dict = {} #Dictionary to store matching keypoints and features
    for i in range(len(images)):
        img_match_dict[i] = {'keypoints': {'src': [], 'dst': []}, 'features': {'src': [], 'dst': []}}
    #Use LightGlue for matching
    matcher = LightGlue(features="superpoint").eval().to(config["device"])
    config["logger"].info('Matching batch features...')
    for i in range(len(images) - 1):
        feat_dict = {'image0': img_feats[i]['src'], 'image1': img_feats[i + 1]['dst']}
        img_matches = matcher(feat_dict)
        feats0, feats1, img_matches = [rbd(x) for x in [feat_dict['image0'], feat_dict['image1'], img_matches]]
        kpts0, kpts1, matches = feats0["keypoints"], feats1["keypoints"], img_matches["matches"]
        
        ###################################################
        #Find which keypoints were matched and move to cpu#
        ###################################################
        m_kpts0, m_kpts1 = kpts0[matches[..., 0]], kpts1[matches[..., 1]]
        m_kpts0_np = m_kpts0.cpu().numpy()
        m_kpts1_np = m_kpts1.cpu().numpy()
        
        ###############################################################################
        #Filter the matches based on RANSAC inliers of a partial affine transformation#
        ###############################################################################
        H, mask = cv2.estimateAffinePartial2D(m_kpts0_np, m_kpts1_np, cv2.RANSAC, ransacReprojThreshold  = 3.0)
        k0_idx = matches[:,0].cpu().numpy()[mask.astype(bool).flatten()]
        k1_idx = matches[:,1].cpu().numpy()[mask.astype(bool).flatten()]
        preselect_kp0, preselect_feat0 = kpts0[k0_idx].cpu().numpy(), feats0['descriptors'][k0_idx].cpu().numpy()
        preselect_kp1, preselect_feat1 = kpts1[k1_idx].cpu().numpy(), feats1['descriptors'][k1_idx].cpu().numpy()
        
        ########################
        #Store filtered matches#
        ########################
        img_match_dict[i]['keypoints']['src'] = [keypoint for keypoint in preselect_kp0.tolist()]
        img_match_dict[i]['features']['src'] = [feature for feature in preselect_feat0.tolist()]
        img_match_dict[i + 1]['keypoints']['dst'] = [keypoint for keypoint in preselect_kp1.tolist()]
        img_match_dict[i + 1]['features']['dst'] = [feature for feature in preselect_feat1.tolist()]
    return img_match_dict

def build_panorama_opencv_objects(images, img_matches):
    ########################################################
    #To provide access to OpenCV functions, convert matches#
    #into OpenCV objects for potential future use          #
    ########################################################
    cv_features = []
    for idx in range(len(images)):
        #Unpack matched features and keypoints
        feat = cv2.detail.computeImageFeatures2(cv2.ORB.create(), images[idx])
        keypoints = np.array(img_matches[idx]['keypoints']['src'] + img_matches[idx]['keypoints']['dst'])
        feat.keypoints = tuple(cv2.KeyPoint(keypoints[x, 0], keypoints[x, 1], 0.0) for x in range(len(keypoints)))
        feat.descriptors = cv2.UMat(np.array(img_matches[idx]['features']['src'] + img_matches[idx]['features']['dst'], dtype = np.float32))
        cv_features.append(feat)
        
    ############################
    #Calculate pairwise matches#
    ############################
    pairs = itertools.product(range(len(cv_features)), range(len(cv_features)))
    matches = []
    #Since we only want subsequent images matched, we only calculate matches between images and
    #the previous or next image, the other pairwise matches are set to have no matches
    #to prevent mismatches across images.
    for i, j in pairs:
        if abs(j - i) > 1 or i == j:
            match = cv2.detail.MatchesInfo()
            if i == j:
                #This matches convention of cv matching of self to self
                match.src_img_idx, match.dst_img_idx = -1, -1
            else:
                match.src_img_idx, match.dst_img_idx = i, j
            match.H = np.zeros((0, 0), dtype=np.float64)
            match.confidence = 0.0
            match.inliers_mask = np.array([], dtype=np.uint8)
            match.num_inliers = 0
            match.matches = []
        else:
            matcher = cv2.detail_AffineBestOf2NearestMatcher(full_affine = False, try_use_gpu = False, match_conf = 0.1, num_matches_thresh1 = 6)
            #apply2 finds all pairwise matches and is accelerated by TBB, but we can beat that performance
            #serially by simply skipping most pairs
            match = matcher.apply(cv_features[i], cv_features[j])
            match.src_img_idx, match.dst_img_idx = i, j
        matches.append(match)
        
    ################################################################################################
    #If not using OpenCV for the warping and camera estimation, we only need the matching keypoints#
    ################################################################################################
    img_keypoints = {i: img_matches[i]['keypoints'] for i in range(len(images))}
    return cv_features, matches, img_keypoints

def find_pano_corners(thresh, config):
    #######################################################################
    #To find the corners of the panorama, we find the convex hull points  #
    #of the thresholded image that are closest to the corners of the image#
    #######################################################################
    #Find corners of thresholded image
    ymax, xmax = thresh.shape
    top_left = [0, 0]
    top_right = [xmax, 0]
    bottom_left = [0, ymax]
    bottom_right = [xmax, ymax]
    #Min and max distance between corners on the same side 
    distance_min, distance_max = config["img_dims"][1] * 0.5, config["img_dims"][1] * 1.5
    
    #################################################################################
    #Get convex hull points of threshold image, this should include the true corners#
    #################################################################################
    contours, h = cv2.findContours(thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    cnt_pts = contours[0].reshape(contours[0].shape[0], contours[0].shape[2])
    hull = cv2.convexHull(cnt_pts)
    hull_pts = hull.reshape(hull.shape[0], hull.shape[2])
    hull_pts = np.array(hull_pts, dtype = np.int64) #Convert to int64 to handle large numbers
    if len(hull_pts) < 4:
        raise ValueError("Panorama corners were estimated poorly because there were insufficient convex hull points")
    amin, amax = np.min(hull_pts[:, 0]), np.max(hull_pts[:, 0])

    ##############################################################################
    #The lowest and highest x values should be corners, but we need to break ties#
    ##############################################################################
    hmin_idxs = np.where(hull_pts[:, 0] == amin)[0]
    if len(hmin_idxs) == 1:
        hmin = hull_pts[hmin_idxs]
    else:
        ########################################################################
        #Find the point with the lowest x that also is closest to a left corner#
        ########################################################################
        hmins = hull_pts[hmin_idxs]
        distances = [min(((pt - top_left)**2).sum(axis = 0), ((pt - bottom_left)**2).sum(axis = 0)) for pt in hmins]
        hmin = hmins[np.argmin(distances)]
    if len(hmin) != 2:
        raise ValueError("Panorama corners were estimated poorly because corner had wrong dimensions")
        
    ###############################################################
    #Get slope and distance between hmin and all other hull points#
    ###############################################################
    hmin_vectors = np.array([[abs((pt[1] - hmin[1])/(pt[0] - hmin[0] + 0.1)),
                              ((pt[1] - hmin[1])**2 + (pt[0] - hmin[0])**2)**0.5,
                              pt[0], pt[1]] for pt in hull_pts])
    
    ############################################################################
    #First filter out any points that are too close or too far to be considered#
    ############################################################################
    hmin_distance_filtered = hmin_vectors[np.where((hmin_vectors[:, 1] > distance_min) & (hmin_vectors[:, 1] < distance_max))[0]]
    if len(hmin_distance_filtered) == 0:
        raise ValueError("Panorama corners were estimated poorly because the identified corners were too close or too far")
        
    ###########################################################
    #Round the slopes so that small differences are minimized #
    #then of the points with the highest slope, choose the one#
    #that is furthest from hmin                               #
    ###########################################################
    hmin_distance_filtered[:, 0] = hmin_distance_filtered[:, 0]//(1 + (np.max(hmin_distance_filtered[:, 0])//10))
    hmin_slope_filtered = hmin_distance_filtered[np.where(hmin_distance_filtered[:, 0] == np.max(hmin_distance_filtered[:, 0]))[0]]
    hmin_partner = hmin_slope_filtered[np.argmax(hmin_slope_filtered[:, 1])][2:]
    
    #######################################
    #Sort between top left and bottom left#
    #######################################
    if hmin[1] < hmin_partner[1]:
        tl = hmin
        bl = hmin_partner
    else:
        tl = hmin_partner
        bl = hmin
        
    ##############################################################################
    #The lowest and highest x values should be corners, but we need to break ties#
    ##############################################################################
    hmax_idxs = np.where(hull_pts[:, 0] == amax)[0]
    if len(hmax_idxs) == 1:
        hmax = hull_pts[hmax_idxs]
    else:
        ##########################################################################
        #Find the point with the highest x that also is closest to a right corner#
        ##########################################################################
        hmaxs = hull_pts[hmax_idxs]
        distances = [min(((pt - top_right)**2).sum(axis = 0), ((pt - bottom_right)**2).sum(axis = 0)) for pt in hmaxs]
        hmax = hmaxs[np.argmin(distances)]
    if len(hmax) != 2:
        raise ValueError("Panorama corners were estimated poorly because corner had wrong dimensions")
    ###############################################################
    #Get slope and distance between hmax and all other hull points#
    ###############################################################
    hmax_vectors = np.array([[abs((pt[1] - hmax[1])/(pt[0] - hmax[0] + 0.1)),
                              ((pt[1] - hmax[1])**2 + (pt[0] - hmax[0])**2)**0.5,
                              pt[0], pt[1] ] for pt in hull_pts])
    
    ############################################################################
    #First filter out any points that are too close or too far to be considered#
    ############################################################################
    hmax_distance_filtered = hmax_vectors[np.where((hmax_vectors[:, 1] > distance_min) & (hmax_vectors[:, 1] < distance_max))[0]]
    if len(hmax_distance_filtered) == 0:
        raise ValueError("Panorama corners were estimated poorly because the identified corners were too close or too far")
        
    ###########################################################
    #Round the slopes so that small differences are minimized #
    #then of the points with the highest slope, choose the one#
    #that is furthest from hmax                               #
    ###########################################################
    hmax_distance_filtered[:, 0] = hmax_distance_filtered[:, 0]//(1 + (np.max(hmax_distance_filtered[:, 0])//10))
    hmax_slope_filtered = hmax_distance_filtered[np.where(hmax_distance_filtered[:, 0] == np.max(hmax_distance_filtered[:, 0]))[0]]
    hmax_partner = hmax_slope_filtered[np.argmax(hmax_slope_filtered[:, 1])][2:]
    
    #########################################
    #Sort between top right and bottom right#
    #########################################
    if hmax[1] < hmax_partner[1]:
        tr = hmax
        br = hmax_partner
    else:
        tr = hmax_partner
        br = hmax 
    closest_corners = np.array([tl, tr, br, bl], dtype = int)
    return closest_corners

def make_spline(pts, spline_pts):
    #######################################
    #Convert 2D point set into spline with#
    #set number of evenly spaced points   #
    #######################################
    dp = pts[1:, :] - pts[:-1, :] #Get vectors between points
    l = (dp**2).sum(axis=1) #Get magnitude of vectors
    vector = np.sqrt(l).cumsum() #Get magnitude of vectors 
    vector = np.r_[0, vector] #Pad with 0
    spl = sp.interpolate.make_interp_spline(vector, pts, axis=0)
    uu = np.linspace(vector[0], vector[-1], spline_pts)
    spline = np.round(spl(uu))
    return spline

def smooth_splines(top_contour_pts, bottom_contour_pts, spline_pts, config):
    #################################################################
    #Take top and bottom border points of image and down sample into#
    #smooth splines by smoothing corners and rolling averages       #
    #################################################################
    
    ################
    #Smooth corners#
    ################
    smooth_corner_top = smooth_corners(top_contour_pts, True, config)
    smooth_corner_bottom = smooth_corners(bottom_contour_pts, False, config)
    
    ##############
    #Make splines#
    ##############
    top_spline = make_spline(smooth_corner_top, spline_pts)
    bottom_spline = make_spline(smooth_corner_bottom, spline_pts)
    mid_spline = np.mean(np.array([top_spline, bottom_spline]), axis = 0)
    
    ###################################
    #Now smooth top and bottom splines#
    ###################################
    smooth_top_spline = np.copy(top_spline)
    smooth_top_spline[:, 1] = smooth1D(top_spline[:, 1], config["points_per_image"])
    smooth_bottom_spline = np.copy(bottom_spline)
    smooth_bottom_spline[:, 1] = smooth1D(bottom_spline[:, 1], config["points_per_image"])
    
    ############################################################################
    #But take the interior points  if the smooth spline would get a black pixel#
    ############################################################################
    smooth_top_spline[:, 1] = np.max(np.array([smooth_top_spline[:, 1], top_spline[:, 1]]), axis = 0)
    smooth_bottom_spline[:, 1] = np.min(np.array([smooth_bottom_spline[:, 1], bottom_spline[:, 1]]), axis = 0)
    mid_spline = np.mean(np.array([smooth_top_spline, smooth_bottom_spline]), axis = 0)
    return mid_spline, smooth_top_spline, smooth_bottom_spline

def smooth2D(pts, window):
    ###########################################################
    #Smooth x and y coordinates of array with a sliding window#
    ###########################################################
    x = np.pad(pts[:,0], (window//2, window - 1 - window//2), mode = 'edge')
    y = np.pad(pts[:,1], (window//2, window - 1 - window//2), mode = 'edge')
    smooth_x = np.convolve(x, np.ones((window,))/window, mode = 'valid')
    smooth_y = np.convolve(y, np.ones((window,))/window, mode = 'valid')
    smoothed = np.column_stack((smooth_x, smooth_y))
    return smoothed

def smooth1D(pts, window):
    ######################################################
    #Smooth 1D coordinates of array with a sliding window#
    ######################################################
    x = np.pad(pts, (window//2, window - 1 - window//2), mode = 'edge')
    smooth_x = np.convolve(x, np.ones((window,))/window, mode = 'valid')
    return smooth_x

def find_consecutive_sequences(data):
    #########################################
    #Find sequences with consecutive indices#
    #########################################
    sequences = []
    for k, g in itertools.groupby(enumerate(data), lambda x: x[0] - x[1]):
        group = list(map(lambda x: x[1], g))
        #############################################
        #Return start and stop indices of each group#
        #############################################
        sequences.append([group[0], group[-1]])
    return sequences

def smooth_corners(spline_pts, top, config):
    ##################################################
    #Remove sharp corners where image edges stick out#
    ##################################################
    grad = np.gradient(spline_pts[:, 1])
    grad = smooth1D(grad, config["points_per_image"])
    idxs = np.where(np.abs(grad) > 1.0)[0]
    
    ####################################
    #Find areas where the slope is high#
    ####################################
    sequences = find_consecutive_sequences(idxs)
    smoothed = np.copy(spline_pts)
    
    ################################
    #Smooth regions with high slope#
    ################################
    for i, j in sequences:
        if spline_pts[i, 1] > spline_pts[j, 1]:
            max_idx, min_idx = i, j
            max_val, min_val = spline_pts[i, 1], spline_pts[j, 1]
        else:
            max_idx, min_idx = j, i
            max_val, min_val = spline_pts[j, 1], spline_pts[i, 1]
        ##########################################
        #Distance over which to smooth the corner#
        ##########################################
        distance = (max_val - min_val)*2 #we set the slope to 0.5 to try to avoid sharp jumps
        
        #####################################################################
        #Smooth corners to the interior of the image to minimize black space#
        #####################################################################
        if top:
            if max_idx > min_idx:
                start_idx, stop_idx = max_idx - distance, max_idx
                start_idx = max(0, start_idx)
                stop_idx = min(stop_idx, len(spline_pts) - 1)
                start_val, stop_val = spline_pts[start_idx, 1], max_val
            else:
                start_idx, stop_idx = max_idx, max_idx + distance
                start_idx = max(0, start_idx)
                stop_idx = min(stop_idx, len(spline_pts) - 1)
                start_val, stop_val = max_val, spline_pts[stop_idx, 1]
        else:
            if min_idx > max_idx:
                start_idx, stop_idx = min_idx - distance, min_idx
                start_idx = max(0, start_idx)
                stop_idx = min(stop_idx, len(spline_pts) - 1)
                start_val, stop_val = spline_pts[start_idx, 1], min_val
            else:
                start_idx, stop_idx = min_idx, min_idx + distance
                start_idx = max(0, start_idx)
                stop_idx = min(stop_idx, len(spline_pts) - 1)
                start_val, stop_val = min_val, spline_pts[stop_idx, 1]
                
        ##################################
        #Sand corners with constant slope#
        ##################################
        smoothed[start_idx:stop_idx, 1] = np.linspace(start_val, stop_val, stop_idx - start_idx, dtype = int)
        
        ##############################################
        #Further smooth the spline after edge removal#
        ##############################################
        smoothed[:, 1] = smooth1D(smoothed[:, 1], config["points_per_image"])
        #But keep interior points
        if top:
            smoothed[:, 1] = np.max(np.array([smoothed[:, 1], spline_pts[:, 1]]), axis = 0)
        else:
            smoothed[:, 1] = np.min(np.array([smoothed[:, 1], spline_pts[:, 1]]), axis = 0)
    return smoothed

def find_peaks_ids(smooth_ddy, max_space, config):
    #######################################################################
    #Find areas with high curvature based on the second derivative        #
    #of the vertical coordinates where the panorama should be sliced      #
    #as well as periodic slice points so that there are no sections longer#
    #than max_space                                                       #
    #######################################################################
    pos_peaks, _ = sp.signal.find_peaks(smooth_ddy, height = config["straightening_threshold"], distance = config["points_per_image"]//3)
    neg_peaks, _ = sp.signal.find_peaks(-1*smooth_ddy, height = config["straightening_threshold"], distance = config["points_per_image"]//3)
    peak_idxs = np.concatenate((pos_peaks, neg_peaks))
    peak_idxs = np.sort(peak_idxs)
    #Add first and last spline point
    peak_idxs = np.insert(peak_idxs, 0, [0])
    peak_idxs = np.append(peak_idxs, [len(smooth_ddy) - 1])
    
    #####################################################
    #Slice the panorama at peaks and add in slice points#
    #in between peaks if the gaps are large             #
    #####################################################
    #If the panorama is very long, we need more spline points so that the
    #midline captures the panorama curvature and to avoid hitting the upper limit on
    #OpenCV image size that can be used in warpPerspective (SHRT_MAX)
    spaced_idxs = [peak_idxs[0]]
    for i in range(1, len(peak_idxs)):
        diff = peak_idxs[i] - peak_idxs[i-1]
        if diff > max_space:
            num_inserts = int(diff // max_space)
            increment = diff / (num_inserts + 1)
            for j in range(1, num_inserts + 1):
                spaced_idxs.append(round(peak_idxs[i-1] + increment * j))
        spaced_idxs.append(peak_idxs[i])
    spaced_idxs = np.array(spaced_idxs)
    return spaced_idxs

def make_smooth_border_splines(thresh, corners, spline_pts, config):
    ###############################################################
    #Generate points along the top and bottom border of a panorama#
    ###############################################################
    top_left, top_right, bottom_right, bottom_left = corners
    
    ############################################################
    #Find the border points and smooth them over the full image#
    #width and with a minimum height to avoid jagged borders   #
    ############################################################
    startx = max(top_left[0], bottom_left[0])
    endx = min(top_right[0], bottom_right[0])
    
    ########################################################
    #Go through each point and find splines that correspond#
    #to the minumum height, we don't worry about top and   #
    #bottom having different lengths because there should  #
    #be low curvature                                      #
    ########################################################
    top, bottom = [], []
    for x in range(startx, endx + 1):
        pix = np.where(thresh[:, x] > 0)[0]
        if len(pix) > 0:
            miny, maxy = np.min(pix), np.max(pix)
            top.append([x, miny])
            bottom.append([x, maxy])
    top_contour_pts = np.array(top)
    bottom_contour_pts = np.array(bottom)

    #############################
    #Convert points into splines#
    #############################
    splines = smooth_splines(top_contour_pts, bottom_contour_pts, spline_pts, config)
    mid_spline, smooth_top_spline, smooth_bottom_spline = splines
    
    ###################################################
    #Standardize heights by cropping to minimum height#
    ###################################################
    height = int(np.min(smooth_bottom_spline[:, 1] - smooth_top_spline[:, 1]))
    smooth_top_spline = mid_spline - np.array([0, height//2])
    smooth_bottom_spline = mid_spline + np.array([0, height//2])
    return smooth_top_spline, smooth_bottom_spline, mid_spline

def divide_splines(top_spline, bottom_spline, mid_spline, spline_pts, max_space, config):
    ############################################################################
    #We search the panorama boundary and midline splines for points of interest#
    #that we will use to divide the panorama into slices to warp               #
    ############################################################################
    #We warp all of the slices into rectangle with the median height and midline width
    top_bottom_distances = bottom_spline - top_spline
    top_bottom_distances = np.sqrt((top_bottom_distances**2).sum(axis = 1))
    rectangular_height = np.round(np.median(top_bottom_distances)).astype(int)
    mid_vector = (mid_spline[1:, :] - mid_spline[:-1, :])
    mid_widths = np.sqrt((mid_vector**2).sum(axis = 1))
    mid_widths = mid_widths.astype(int)
    rectangular_width = np.sum(mid_widths)
    cumulative_widths = np.append(np.array([0]), np.cumsum(mid_widths)).astype(int)
    
    #########################################################
    #Find sections of the midline that bend past a threshold#
    #########################################################    
    scaled_spline = (mid_spline[:, 1]/((mid_spline[-1, 0] - mid_spline[0, 0])/spline_pts))
    der2 = sp.signal.savgol_filter(scaled_spline, window_length = config["points_per_image"], polyorder=2, deriv=2, mode = "nearest")
    spaced_idxs = find_peaks_ids(der2, max_space, config)
    
    ####################################
    #Calculate slice widths and corners#
    ####################################
    #Width of each slice
    widths = np.array([cumulative_widths[spaced_idxs[i]] - cumulative_widths[spaced_idxs[i-1]] for i in range(1, len(spaced_idxs))])
    #Corners of each slice in order with top left, top right, bottom right, bottom left
    corners = np.array([[top_spline[spaced_idxs[i]], top_spline[spaced_idxs[i + 1]],
                        bottom_spline[spaced_idxs[i + 1]], bottom_spline[spaced_idxs[i]]]
                        for i in range(len(spaced_idxs) - 1)], dtype = np.int64)
    #Return slice corners and widths as well as the final width and height to project into
    return corners, rectangular_width, rectangular_height, widths

def make_batch_splines(thresh, start, stop, spline_pts, config):
    ###################################
    #Get contour points for boundaries#
    ###################################
    top_contour_pts = []
    bottom_contour_pts = []

    for x in range(start, stop):
        pix = np.where(thresh[:, x] > 0)[0]
        if len(pix) > 0:
            top_contour_pts.append([x, np.min(pix)])
    for x in range(start, stop):
        pix = np.where(thresh[:, x] > 0)[0]
        if len(pix) > 0:
            bottom_contour_pts.append([x, np.max(pix)])
    top_contour_pts = np.array(top_contour_pts)
    bottom_contour_pts = np.array(bottom_contour_pts)

    ###################################
    #Use points to make smooth splines#
    ###################################
    splines = smooth_splines(top_contour_pts, bottom_contour_pts, spline_pts, config)
    mid_spline, smooth_top_spline, smooth_bottom_spline = splines
    return mid_spline, smooth_top_spline, smooth_bottom_spline

def anchor_edge_images(img, config):
    ##########################################################################
    #To try to keep scale consistent and improve stitching across batches    #
    #we try to mask the first and last image used in the batch so that their #
    #original dimensions are preserved. Then we find anchor points along each# 
    #batch that we can use to straighten each batch. This should result in   # 
    #the first and last image in each batch being straight and with minimal  #
    #change in field of view, which in turn should allow for translation only#
    #stitching of batches with the scale preserved across batches.           #
    ##########################################################################
    
    ##############################################################################
    #First try to clean the edges of the batch so the anchor images "stand alone"#
    ##############################################################################
    thresh, t_start, t_stop, b_start, b_stop = mask_anchor_images(img, config)
    start = max(t_start, b_start)
    stop = min(t_stop, b_stop)
    spline_pts = max(config["points_per_image"], int(config["points_per_image"]*((stop - start)/config["img_dims"][0])))
    splines = make_batch_splines(thresh, start, stop, spline_pts, config)
    mid_spline, smooth_top_spline, smooth_bottom_spline = splines
    
    ########################################
    #Get anchor points, widths, and heights#
    ########################################
    top_anchors, bottom_anchors, mid_anchors = get_all_anchor_points(mid_spline, smooth_top_spline, smooth_bottom_spline, spline_pts, config)
    heights = np.linalg.norm(bottom_anchors - top_anchors, axis = 1).astype(int)
    mid_vector = (mid_anchors[1:, :] - mid_anchors[:-1, :])
    widths = np.sqrt((mid_vector**2).sum(axis = 1)).astype(int)
    slice_corners = np.array([[top_anchors[i], top_anchors[i + 1], 
                               bottom_anchors[i + 1], bottom_anchors[i]] 
                               for i in range(len(widths))], dtype = int)
    return slice_corners, widths, heights      

def mask_anchor_images(img, config):
    #########################################################################
    #We look at the vertical edges of the batch and estimate the warped     #
    #orientation and dimensions of these anchor images. Then we cut around  #
    #these anchors so that in the straightened batch, anchors across batches#
    #should align well                                                      #
    #########################################################################
    
    ##################################################
    #Get corners from a thresholded image with border#
    ##################################################
    image = cv2.copyMakeBorder(img, 100, 100, 100, 100, cv2.BORDER_CONSTANT) #add padding for corner finding
    thresh = threshold_image(image, 0, 0)
    (top_left, top_right, bottom_right, bottom_left) = find_pano_corners(thresh, config)

    ################################################################
    #Estimate the anchor image orientations by the vertical borders#
    ################################################################
    left_edge = bottom_left - top_left
    left_edge_length = np.linalg.norm(left_edge)
    left_vector = left_edge/left_edge_length
    left_edge_normal = np.array([left_vector[1], -1*left_vector[0]])
    left_center = np.mean([top_left, bottom_left], axis = 0)
    left_slope = left_edge_normal[1]/left_edge_normal[0]
    
    right_edge = bottom_right - top_right
    right_edge_length = np.linalg.norm(right_edge)
    right_vector = right_edge/right_edge_length
    right_edge_normal = np.array([-1*right_vector[1], right_vector[0]])
    right_center = np.mean([top_right, bottom_right], axis = 0)
    right_slope = right_edge_normal[1]/right_edge_normal[0]

    #############################################################
    #Determine where the two top and bottom lines will intersect#
    #############################################################
    A = np.array([left_edge_normal, -1* right_edge_normal]).T
    
    ####################
    #Top interserctions#
    ####################
    b = top_right - top_left
    try:
        intersection_solution = np.linalg.solve(A, b)
    except np.linalg.LinAlgError:
        intersection_solution = np.array([0, 0])

    if not np.all(intersection_solution > 0):
        top_cross = np.inf
    else:
        if np.max(intersection_solution) > config["img_dims"][0]:
            top_cross = np.inf
        else:
            top_cross = np.min(intersection_solution)
            
    ######################
    #Bottom intersections#
    ######################
    b = bottom_right - bottom_left
    try:
        intersection_solution = np.linalg.solve(A, b)
    except np.linalg.LinAlgError:
        intersection_solution = np.array([0, 0])
    if not np.all(intersection_solution > 0):
        bottom_cross = np.inf
    else:
        if np.max(intersection_solution) > config["img_dims"][0]:
            bottom_cross = np.inf
        else:
            bottom_cross = np.min(intersection_solution)
    
    #############################################
    #Find intersection with top and bottom edges#
    #############################################
    if left_slope > 0:
        left_y_intersection = ((thresh.shape[0] - 100) - bottom_left[1])/left_slope
    elif left_slope < 0:
        left_y_intersection = -1*(top_left[1] - 100)/left_slope
    else:
        left_y_intersection = np.inf
    if right_slope > 0:
        right_y_intersection = (top_right[1] - 100)/right_slope
    elif right_slope < 0:
        right_y_intersection = -1*((thresh.shape[0] - 100) - bottom_right[1])/right_slope
    else:
        right_y_intersection = np.inf
        
    ##########################################################################
    #Do not let the edges of anchor images go too far relative to batch width#
    ##########################################################################
    distance_limit = (right_center[0] - left_center[0])/3
    left_distance = min(min(top_cross, bottom_cross), left_y_intersection, distance_limit, config["img_dims"][0])
    right_distance = min(min(top_cross, bottom_cross), right_y_intersection, distance_limit, config["img_dims"][0])

    ##################################################
    #Use intersection distances to find anchor points#
    ##################################################
    bottom_left_anchor = (bottom_left + left_edge_normal * left_distance).astype(int)
    top_left_anchor = (top_left + left_edge_normal * left_distance).astype(int)
    bottom_right_anchor =(bottom_right + right_edge_normal * right_distance).astype(int)
    top_right_anchor = (top_right + right_edge_normal * right_distance).astype(int)
    
    #################################################
    #Mask pixels outside of the anchor image borders#
    #################################################
    for x in range(top_left[0], top_left_anchor[0]):
        ymax = int(top_left[1] + (left_edge_normal[1]/left_edge_normal[0]) * (x - top_left[0]))
        thresh[:ymax, x] = 0
    for x in range(bottom_left[0], bottom_left_anchor[0]):
        ymin = int(bottom_left[1] + (left_edge_normal[1]/left_edge_normal[0]) * (x - bottom_left[0]))
        thresh[ymin:, x] = 0
    for x in range(top_right_anchor[0], top_right[0]):
        ymax = int(top_right_anchor[1] + (right_edge_normal[1]/right_edge_normal[0]) * (x - top_right_anchor[0]))
        thresh[:ymax, x] = 0
    for x in range(bottom_right_anchor[0], bottom_right[0]):
        ymin = int(bottom_right_anchor[1] + (right_edge_normal[1]/right_edge_normal[0]) * (x - bottom_right_anchor[0]))
        thresh[ymin:, x] = 0

    ##########################################
    #Remove borders and get start/stop values#
    ##########################################
    thresh = thresh[100:-100, 100:-100]
    top_start, top_stop = top_left[0] - 100, top_right[0] - 100
    bottom_start, bottom_stop = bottom_left[0] - 100, bottom_right[0] - 100
    return thresh, top_start, top_stop, bottom_start, bottom_stop

def get_all_anchor_points(mid_spline, smooth_top_spline, smooth_bottom_spline, spline_pts, config):
    scaled_spline = (mid_spline[:, 1]/((mid_spline[-1, 0] - mid_spline[0, 0])/spline_pts))
    der2 = sp.signal.savgol_filter(scaled_spline, window_length = config["points_per_image"], polyorder=2, deriv=2, mode = "nearest")
    peak_idxs = find_peaks_ids(der2, config["points_per_image"] * 3, config)
    if 0 not in peak_idxs:
        peak_idxs = np.insert(peak_idxs, 0, [0])
    if len(mid_spline) - 1 not in peak_idxs:
        peak_idxs = np.append(peak_idxs, [len(mid_spline) - 1])
    top_anchors = [smooth_top_spline[i] for i in peak_idxs]
    bottom_anchors = [smooth_bottom_spline[i] for i in peak_idxs]     
    top_anchors = np.array(top_anchors)
    bottom_anchors = np.array(bottom_anchors)
    
    ########################################################
    #Make straight slices so there is no warping distortion#
    ########################################################
    #This sacrifices some field of view at the edges, but should eliminate
    #straightening seams
    mid_anchors = np.mean([top_anchors, bottom_anchors], axis = 0)
    top_anchors[:, 0] = np.copy(mid_anchors[:, 0].astype(int))
    bottom_anchors[:, 0] = np.copy(mid_anchors[:, 0].astype(int))
    return top_anchors, bottom_anchors, mid_anchors

def warp_slice(img, slice_corners, width, height, registration_dict, keys, offset, config):
    ################################################
    #For a given quadrilateral slice of a panorama,#
    #warp into a rectangle                         #
    ################################################
    #A mask to isolate each slice, passed each time because modified in place with fillConvexPoly
    blank_mask = np.zeros((img.shape[0], img.shape[1]), np.uint8)
    #Mask everything but the slice, fillConvexPoly modifies mask in place, so we pass a fresh copy each time
    rect_mask = cv2.fillConvexPoly(blank_mask, slice_corners.reshape((-1, 1, 2)).astype(np.int32), 255)
    rect_img = cv2.bitwise_and(img, img, mask=rect_mask)
    #Resize the slice so it is in its in a rectangular bounding box
    rect_mask_corners = np.where(rect_mask == 255)
    maxy, maxx, miny, minx = np.max(rect_mask_corners[0]), np.max(rect_mask_corners[1]), np.min(rect_mask_corners[0]),  np.min(rect_mask_corners[1])
    rect_mask_bb = rect_img[miny:maxy + 1, minx:maxx + 1]
    #Get target points for a normal rectangle
    rect_points = np.array([[0, 0], [width, 0], [width, height], [0, height]])
    #Translate the corners for a bounding box with top left corner at 0, 0
    translated_corners = np.copy(slice_corners)
    translated_corners[:, 0] -= minx
    translated_corners[:, 1] -= miny
    #Get perspective transform from slice to a rectangle and warp the slice
    H = cv2.getPerspectiveTransform(translated_corners.astype(np.float32), rect_points.astype(np.float32))
    warped = cv2.warpPerspective(rect_mask_bb, H, (width, height))
    
    ####################
    #Warp registrations#
    ####################
    for i in range(len(keys)):
        point = registration_dict[keys[i]].copy()
        #Translate point to local slice coordinates
        local_point = point - np.array([minx, miny])
        warped_point = cv2.perspectiveTransform(np.reshape(local_point, (1, 1, 2)), H)[0][0]
        #Translate back to global x coordinates by the global start of this slice
        global_point = warped_point + np.array([offset, 0])
        registration_dict[keys[i]] = global_point
    return warped

def warp_mosaic(img, all_corners, rectangular_width, rectangular_height, widths, config):
    ###########################################
    #Link registration points with warp slices#
    ###########################################
    registration_dict = config["registration"]
    #Remove keys that are sliced out when anchoring the batch
    registration_dict = {key:val for key, val in registration_dict.items() if ((val[0] >= all_corners[0, 0, 0]) & (val[0] <= all_corners[-1, 1, 0]))}
    img_keys = list(registration_dict.keys())
    positions = np.array(list(registration_dict.values())).copy()
    x_positions = positions[:,0]
    cumulative_widths = np.append(np.array([0]), np.cumsum(widths)).astype(int)

    ###########################
    #Warp and place each slice#
    ###########################
    #Blank canvas to project warped slices into
    blank = np.zeros((rectangular_height, rectangular_width, 3))
    for i in range(len(widths)):
        """Since slicing off ends of batch sometimes, the included keypoints must be ones within the slice domain """
        key_idxs = np.where((x_positions >= all_corners[i, 0, 0]) & (x_positions <= all_corners[i, 1, 0]))[0]
        keys = [img_keys[i] for i in key_idxs]
        #Corners of the sliced quadrilateral with top left, top right, bottom right, bottom left
        corners, width, offset = all_corners[i], widths[i], cumulative_widths[i]
        warped = warp_slice(img, corners, width, rectangular_height, registration_dict, keys, offset, config)
        blank[:,cumulative_widths[i]: cumulative_widths[i + 1]] = warped
    return blank.astype(np.uint8)

def warp_batch(img, corners, widths, heights, batch, config):
    ###########################################
    #Link registration points with warp slices#
    ###########################################
    my_batch = list(config["registration"].keys())[batch]
    registration_dict = config["registration"][my_batch]
    #Remove keys that are sliced out when anchoring the batch
    registration_dict = {key:val for key, val in registration_dict.items() if ((val[0] >= corners[0, 0, 0]) & (val[0] <= corners[-1, 1, 0]))}
    img_keys = list(registration_dict.keys())
    positions = np.array(list(registration_dict.values())).copy()
    x_positions = positions[:,0]
    cumulative_widths = np.append(np.array([0]), np.cumsum(widths)).astype(int)
    median_ht = int(np.median(heights))

    ###########################
    #Warp and place each slice#
    ###########################
    #Blank canvas to project warped slices into
    blank = np.zeros((median_ht, np.sum(widths), 3))
    for i in range(len(widths)):
        key_idxs = np.where((x_positions >= corners[i, 0, 0]) & (x_positions <= corners[i, 1, 0]))[0]
        keys = [img_keys[i] for i in key_idxs]
        #Corners of the sliced quadrilateral with top left, top right, bottom right, bottom left
        warped = warp_slice(img, corners[i], widths[i], median_ht, registration_dict, keys, cumulative_widths[i], config)
        blank[:, cumulative_widths[i]: cumulative_widths[i + 1]] = warped
    return blank.astype(np.uint8)

def straighten_batch(img, batch, config):
    corners, widths, heights = anchor_edge_images(img, config)
    straightened = warp_batch(img, corners, widths, heights, batch, config)
    return straightened

def straighten_mosaic(img, config):
    #############################################################
    #Straighten panorama by cutting it into quadrilateral slices#
    #and projecting them to rectangles                          #
    #############################################################
    #Pad the images and threshold to make a mask of the panorama
    image = cv2.copyMakeBorder(img, 10, 10, 10, 10, cv2.BORDER_CONSTANT) #add padding for corner finding
    thresh = threshold_image(image, 10, 0)
    corners = find_pano_corners(thresh, config)

    ##########################
    #Calculate spline points#
    #########################
    image_widths = round(thresh.shape[1]/config["img_dims"][0])
    #Since we smooth the splines, we need some minimum number of points
    spline_pts = max(config["points_per_image"], int(image_widths * config["points_per_image"]))
    #Threshold past which another slice should be made, regardless of curvature
    #in units of original image widths
    slice_threshold = 5*config["points_per_image"]

    ##############################################################
    #Link registration points with warp slices and get boundaries#
    ##############################################################
    #Final straightening with smooth borders and low threshold for straightening
    top_spline, bottom_spline, mid_spline = make_smooth_border_splines(thresh, corners, spline_pts, config)
    slice_corners, rectangular_width, rectangular_height, widths = divide_splines(top_spline, bottom_spline, mid_spline,
                                                                                  spline_pts, slice_threshold, config)
    #############################
    #Slice and warp final mosaic#
    #############################
    straightened_mosaic = warp_mosaic(image, slice_corners, rectangular_width, rectangular_height, widths, config)
    return straightened_mosaic

def match_batch_scale(straightened_imgs, config):
    #############################################################
    #Adjust mosaics so that stitching edges have the same height#
    #to match the scale across batches                          #
    #############################################################
    scaled_imgs = [straightened_imgs[0]]
    for i in range(len(straightened_imgs) - 1):
        src_ht, _ = get_stitch_edge_heights(scaled_imgs[i], config)
        _, dst_ht = get_stitch_edge_heights(straightened_imgs[i + 1], config)
        scale_factor = src_ht/dst_ht
        scaled = cv2.resize(straightened_imgs[i + 1], dsize = None, fx = scale_factor, fy = scale_factor)
        scaled_imgs.append(scaled)
        batch = list(config["registration"].keys())[i]
        for image, points in config["registration"][batch].items():
            points *= scale_factor
    return scaled_imgs

def get_stitch_edge_heights(img, config):
    #########################################
    #Find height of panorama stitching edges#
    #########################################
    thresh = threshold_image(img, 0, 0)
    thresh = (thresh/255) 
    heights = np.sum(thresh, axis = 0)
    #We get the height at the 1/5 the width of the original image width since small angles in warping
    #can lead to edge effects
    width = config["img_dims"][0]
    test_position = int(width * 0.2)
    src_stitch_height = heights[test_position]
    dst_stitch_height = heights[-test_position]
    return src_stitch_height, dst_stitch_height

def adjust_batches(batch_imgs, config):
    ##############################################################
    #Pad images to have equal size in the non-stitching direction#
    ##############################################################
    image_dims = np.array([img.shape for img in batch_imgs])[:,:2]
    #Put padding on the bottom of images
    pad = np.max(image_dims[:,0]) - image_dims[:,0]
    padded_images = [cv2.copyMakeBorder(batch_imgs[i], 0, pad[i],  0, 0, cv2.BORDER_CONSTANT) for i in range(len(batch_imgs))]
    return padded_images

def resize_panorama(panorama, config):
    #############################################
    #Resize panorama according to config options#
    #############################################
    width, height = config["final_size"]
    if width == 0 or height == 0:
        aspect_ratio = panorama.shape[1]/panorama.shape[0]
        #################
        #Scale to height#
        #################
        if width == 0 and height > 0:
            final_size = cv2.resize(panorama, (int(aspect_ratio * height) , height), interpolation=cv2.INTER_NEAREST)
            scalex, scaley, padx, pady = int(aspect_ratio * height)/panorama.shape[1], height/panorama.shape[0], 0, 0
            ###############
            #Adjust width#
            ###############
            if config["crop_size"]> 0:
                crop_width = config["crop_size"]
                current_width = final_size.shape[1]
                #####################
                #Crop image to width#
                #####################
                if current_width > crop_width:
                    if (current_width - crop_width)%2 == 0:
                        start_x, stop_x = (current_width - crop_width)//2, (current_width - crop_width)//2
                    else:
                        start_x, stop_x = 1 + (current_width - crop_width)//2, (current_width - crop_width)//2
                    final_size = final_size[:, start_x:-stop_x, :]
                    padx, pady = -start_x, 0
                ####################
                #Pad image to width#
                ####################
                else:
                    if (crop_width - current_width)%2 == 0:
                        left, right = (crop_width - current_width)//2, (crop_width - current_width)//2
                    else:
                        left, right = (crop_width - current_width)//2, (crop_width - current_width)//2 + 1
                    final_size = cv2.copyMakeBorder(final_size, 0, 0, left, right, cv2.BORDER_CONSTANT)
                    padx, pady = left, 0
        ################
        #Scale to width#
        ################
        elif height == 0 and width > 0:
            final_size = cv2.resize(panorama, (width, int(width/aspect_ratio)), interpolation=cv2.INTER_NEAREST)
            scalex, scaley, padx, pady = width/panorama.shape[1], int(width/aspect_ratio)/panorama.shape[0], 0, 0
            ###############
            #Adjust height#
            ###############
            if config["crop_size"] > 0:
                crop_height = config["crop_size"]
                current_height = final_size.shape[0]
                ######################
                #Crop image to height#
                ######################
                if current_height > crop_height:
                    if (current_height - crop_height)%2 == 0:
                        start_y, stop_y = (current_height - crop_height)//2, (current_height - crop_height)//2
                    else:
                        start_y, stop_y = 1 + (current_height - crop_height)//2, (current_height - crop_height)//2
                    final_size = final_size[start_y: -stop_y, :, :]
                    padx, pady = 0, -start_y
                #####################
                #Pad image to height#
                #####################
                else:
                    if (crop_height - current_height)%2 == 0:
                        top, bottom = (crop_height - current_height)//2, (crop_height - current_height)//2
                    else:
                        top, bottom = (crop_height - current_height)//2, (crop_height - current_height)//2 + 1
                    final_size = cv2.copyMakeBorder(final_size, top, bottom, 0, 0, cv2.BORDER_CONSTANT)
                    padx, pady = 0, top
        #############################
        #Invalid resizing parameters#
        #############################
        else:
            config["logger"].warning("Invalid resizing parameters")
            final_size = panorama
            scalex, scaley, padx, pady = 1.0, 1.0, 0, 0
    #############
    #Full resize#
    #############
    else:
        scalex, scaley, padx, pady = width/panorama.shape[1], height/panorama.shape[0], 0, 0
        final_size = cv2.resize(panorama, (width, height), interpolation=cv2.INTER_NEAREST)

    return final_size, scalex, scaley, padx, pady
    
def stitch_final_mosaic(config):
    #######################################################################
    #Take existing panoramas and stitch them into one final super panorama#
    #######################################################################
    config["logger"].info("Retrieving batches...")
    
    ##################################################
    #Read in the previously created panoramas and pad#
    ##################################################
    #We assume that the only files in the batch_path are the panoramas
    image_types = ('.png', '.jpg', 'jpeg', '.tiff', 'tif', '.gif', '.img')
    batch_paths = [os.path.join(config["output_path"], img_name) for img_name in os.listdir(config["output_path"]) if img_name.endswith(image_types)]
    sorted_batch_paths = sorted_nicely(batch_paths)
    #Keep the numbers associated with each batch for registration
    filenames = [os.path.basename(path) for path in sorted_batch_paths]
    num = np.array([int(file.split("_")[0]) for file in filenames])
    batch_imgs = [cv2.imread(batch_path) for batch_path in sorted_batch_paths]
    

    #################################
    #Straighten and resize panoramas#
    #################################
    #Straighten the panoramas to make it easier to stitch them into a super panorama
    #because the long length of the panoramas means that any rotation when matching
    #panoramas will lead to a large displacement at the other end of the panorama.
    #We assume that the camera path is roughly linear and that panoramas should only be offset to properly stitch them,
    #but to assume that the no rotation is necessary to stitch the panoramas, we should ensure that the edges of the panorama
    #are normal to the camera movement. Since deviations of the camera orientation from the normal plane will cause curving
    #in the panoramas, we pre-straighten the panoramas to make the super panorama stitching easier
    config["logger"].info("Straightening batches...")
    adjusted_imgs = [straighten_batch(image, i, config) for i, image in enumerate(batch_imgs)]
    if config["save_output"]:
        for i, img in enumerate(adjusted_imgs):
            cv2.imwrite(os.path.join(config["output_path"], "straightened_" + str(i) + ".png"), img)
    
    #Match scale across panoramas
    adjusted_imgs = match_batch_scale(adjusted_imgs, config)
    #Now pad the straightened images so the images are all of the same dimension in the non-stitching direction
    adjusted_imgs = adjust_batches(adjusted_imgs, config)

    ########################################################################
    #Find features and matches between the ends of subsequent panoramas and#
    #then stitch them together without any rotation                        #
    ########################################################################
    #To restrict feature matching to the stitching ends of the panoramas, we only search for 
    #features in a search distance from the stitching ends.
    #Since subsequent panoramas overlap by one image, the relevant features should be within one
    #image width of the ends
    search_distance = int(config["img_dims"][0] *1.5)
    img_matches = match_batch_features(adjusted_imgs, search_distance, config)
    cv_features, matches, img_keypoints = build_panorama_opencv_objects(adjusted_imgs, img_matches)
    config["logger"].info("Stitching batches...")
    final_mosaic, corners, sizes = affine_OpenCV_pipeline(adjusted_imgs, img_keypoints, True, config)
    if config["save_output"]:
        cv2.imwrite(os.path.join(config["output_path"], "unstraightened_mosaic.png"), final_mosaic)
    
    #################################
    #Register images in global space#
    #################################
    #Register the top left corners of batches in the superpanorama
    interbatch_registration = {}
    for image_name, corner in zip(np.sort(num), corners):
        interbatch_registration[image_name] = corner

    #Offset image registrations by the global corners of each batch
    #in the super panorama space and take out batch dimension
    global_registration = {}
    for batch, batch_dict in config["registration"].items():
        for image, point in batch_dict.items():
            global_point = point + interbatch_registration[batch]
            #Note: since the first image in one batch is the last image of the last batch, this
            #will overwrite the registration of the last images of each batch except the last one
            global_registration[image] = global_point
    config["registration"] = global_registration
        
    ###########################
    #Save final super panorama#
    ###########################
    save_final_mosaic(final_mosaic, config)
    if not config["save_output"]:
        config["logger"].info('Deleting intermediate images...')
        shutil.rmtree(config["output_path"])
    config["logger"].info("Done")
    
def run_batches(base_config, image_directory, parent_directory):
    ##############################################################
    #Working in batches of images, first construct mini panoramas#
    ##############################################################
    cv2.ocl.setUseOpenCL(False)
    start_time = time.perf_counter()
    config = adjust_config(base_config, image_directory, parent_directory)
    config["logger"].info("Starting {} ".format(image_directory))
    try:
        start_idx = 0 #The image to start stitching
        finished = False #True when you stitch the final image in the directory
        final_img_count = 0
        batch_keys = [] #Stores the img idx of the final image used in the batch
        while not finished:
            #Create panoramas by first stitching batches of images
            #and starting a new stitch from the last image of the previous
            #panorama, leaving one image of overlap between each subsequent panorama
            finished, start_idx, img_count = run_stitching_pipeline(start_idx, config)
            final_img_count += img_count - 1
            batch_keys.append(start_idx)
        final_img_count += 1
        config["logger"].info("Used {} of initial images in final mosaic".format(final_img_count))
        
        ######################################################################
        #If all panorama batches were successful, attempt to stitch them into#
        #the final super panorama.                                           #
        ######################################################################
        output_filename = 'batch_' + os.path.basename(os.path.normpath(config["image_directory"])) + '.png'
        #Retrieve the batches of panoramas that were created
        batch_paths = [os.path.join(config["output_path"], str(i) + "_" + output_filename) for i in batch_keys]
        if len(batch_paths) > 1:
            #If there is more than one panorama, stitch the panoramas together
            stitch_final_mosaic(config)
        else:
            #Otherwise, save the single panorama
            final_mosaic = cv2.imread(batch_paths[0])
            config["registration"] = config["registration"][start_idx]
            save_final_mosaic(final_mosaic, config)
            if not config["save_output"]:
                config["logger"].info('Deleting intermediate images...')
                shutil.rmtree(config["output_path"])
            config["logger"].info("Done")
            
        end_time = time.perf_counter()
        elapsed_time = (end_time - start_time)/60
        config["logger"].info("Total elapsed time: {:.2f} minutes".format(elapsed_time))
        return True
    except ValueError as e:
        config["logger"].error("Error {} caused failure for panorama {}".format(e, image_directory))      
        return False
    except KeyboardInterrupt:
        config["logger"].error("Keyboard interrupt for panorama {}".format(image_directory))  
        return False

def save_final_mosaic(mosaic, config):
    ############
    #Straighten#
    ############
    if config["final_straighten"]:
        config["logger"].info("Straightening final mosaic...")
        mosaic = straighten_mosaic(mosaic, config)
    ##################################
    #Extract registration information#
    ##################################
    if config["GPS"]:
        register_name = os.path.basename(os.path.normpath(config["image_directory"])) + "_gps_registration.csv"
        GPS_data = []
        for image, point in config["registration"].items():
            latitude = config["GPS_data"].loc[config["GPS_data"]["image"] == image, "latitude"].values[0]
            longitude = config["GPS_data"].loc[config["GPS_data"]["image"] == image, "longitude"].values[0]
            GPS_data.append([image, latitude, longitude, point[0], point[1]])
        GPS_data = pd.DataFrame(GPS_data, columns = ["image", "latitude", "longitude", "x", "y"])
    else:
        register_name = os.path.basename(os.path.normpath(config["image_directory"])) + "_image_registration.csv"
        GPS_data = []
        for image, point in config["registration"].items():
            GPS_data.append([image, point[0], point[1]])
        GPS_data = pd.DataFrame(GPS_data, columns = ["image", "x", "y"])
    ##########
    #Reorient#
    ##########
    if config["change_orientation"] is not False:
        config["logger"].info("Re-orienting panorama...")
        if config["change_orientation"] == '180':
            #Flip image across vertical axis so the stitching edge is now on the right
            mosaic = cv2.flip(mosaic, 1)
            GPS_data["x"] = mosaic.shape[1] - GPS_data["x"]
        elif config["change_orientation"] == '90CCW':
            #Rotate 90 degrees CCW so stitching edge is now on the bottom
            mosaic = cv2.rotate(mosaic, cv2.ROTATE_90_COUNTERCLOCKWISE)
            x_vals = GPS_data["x"].values
            y_vals = GPS_data["y"].values
            GPS_data["x"] = y_vals
            GPS_data["y"] = x_vals
            GPS_data["y"] = mosaic.shape[0] - GPS_data["y"]
        elif config["change_orientation"] == '90CW':
            #Rotate 90 degrees CCW so stitching edge is now on the top
            mosaic = cv2.rotate(mosaic, cv2.ROTATE_90_CLOCKWISE)
            x_vals = GPS_data["x"].values
            y_vals = GPS_data["y"].values
            GPS_data["x"] = y_vals
            GPS_data["y"] = x_vals
            GPS_data["x"] = mosaic.shape[1] - GPS_data["x"]
        elif config["GPS"] is not False and config["change_orientation"] == 'COMPASS':
            #Find major axis of movement
            lat_travel = np.max(GPS_data["latitude"].values) - np.min(GPS_data["latitude"].values)
            long_travel = np.max(GPS_data["longitude"].values) - np.min(GPS_data["longitude"].values)
            if lat_travel > long_travel: #Bed is North-South
                corr = np.corrcoef(GPS_data["x"].values, GPS_data["latitude"].values)[0, 1]
                if corr > 0:
                    #Left to Right is South to North, so turn 90CCW so Right is Top
                    mosaic = cv2.rotate(mosaic, cv2.ROTATE_90_COUNTERCLOCKWISE)
                    x_vals = GPS_data["x"].values
                    y_vals = GPS_data["y"].values
                    GPS_data["x"] = y_vals
                    GPS_data["y"] = x_vals
                    GPS_data["y"] = mosaic.shape[0] - GPS_data["y"]
                else:
                    #Right to Left is North to South, so turn 90CW so Left is Top
                    mosaic = cv2.rotate(mosaic, cv2.ROTATE_90_CLOCKWISE)
                    x_vals = GPS_data["x"].values
                    y_vals = GPS_data["y"].values
                    GPS_data["x"] = y_vals
                    GPS_data["y"] = x_vals
                    GPS_data["x"] = mosaic.shape[1] - GPS_data["x"]
            else: #Bed is East-West
                corr = np.corrcoef(GPS_data["x"].values, GPS_data["longitude"].values)[0, 1]
                if corr < 0:
                    #Left to Right is East to West, so flip 180 so Left is East
                    mosaic = cv2.flip(mosaic, 1)
                    GPS_data["x"] = mosaic.shape[1] - GPS_data["x"]
        else:
            config["logger"].warning("Invalid orientation")
            
    ############
    #Save files#
    ############
    if config["save_full_resolution"]:
        config["logger"].info("Saving mosaic at full resolution...")
        cv2.imwrite(os.path.join(config["final_mosaic_path"], "full_res_" + config["final_mosaic_name"]), mosaic)
        GPS_data.to_csv(os.path.join(config["final_mosaic_path"], "full_res_" + register_name))
    if config["save_resized_resolution"]:
        mosaic, scalex, scaley, padx, pady = resize_panorama(mosaic, config)
        config["logger"].info("Saving mosaic at resized resolution...")
        cv2.imwrite(os.path.join(config["final_mosaic_path"], "resized_" + config["final_mosaic_name"]), mosaic)
        GPS_data["x"] *= scalex
        GPS_data["y"] *= scaley
        GPS_data["x"] += padx
        GPS_data["y"] += pady
        GPS_data.to_csv(os.path.join(config["final_mosaic_path"], "resized_" + register_name))
    if config["save_low_resolution"]:
        config["logger"].info('Saving a low resolution version of the mosaic ...')
        mosaic = cv2.resize(mosaic, dsize = None, fx = config["low_resolution"], fy = config["low_resolution"])
        cv2.imwrite(os.path.join(config["final_mosaic_path"], "low_res_" + config["final_mosaic_name"]), mosaic)


def sorted_nicely(l): 
    #################################################
    #Sort file names the way humans would expect    #
    #From Mark Byers 19.04.2010                     #
    #https://stackoverflow.com/questions/           #
    #2669059/how-to-sort-alpha-numeric-set-in-python#
    #################################################
    convert = lambda text: int(text) if text.isdigit() else text 
    alphanum_key = lambda key: [ convert(c) for c in re.split('([0-9]+)', key) ] 
    return sorted(l, key = alphanum_key)

def load_config(config_path):
    ################################################################
    #Load configuration from a YAML file and compile regex patterns#
    ################################################################
    with open(config_path, 'r') as file:
        config = yaml.safe_load(file)

    type_dict = {"image_directory": (str, None),
                 "parent_directory": (str, None),
                 "save_output": (bool, None),
                 "device": (str, ["cuda", "cpu", "mps", "multiprocessing"]),
                 "batch_size": (int, None),
                 "final_resolution": ((int, float),  None),
                 "seam_resolution": (float,  None),
                 "stitching_direction": (str, ["LEFT", "RIGHT", "UP", "DOWN"]),
                 "mask": (list,  int),
                 "camera": (str, ["spherical", "partial_affine"]),
                 "GPS": (bool, None),
                 "keypoint_prop": (float, None),
                 "forward_limit": (int,  None),
                 "xy_ratio":  ((int, float), None),
                 "scale_constraint": ((int, float), None),
                 "min_inliers": (int, None),
                 "max_RANSAC_thresh": ((float, int), None),
                 "max_reprojection_error": ((float, int), None),
                 "final_straighten": (bool, None),
                 "change_orientation": ((str, bool), [False, "90CW", "90CCW", "180", "COMPASS"]),
                 "save_full_resolution": (bool, None),
                 "save_resized_resolution": (bool, None),
                 "final_size": (list, int) ,
                 "crop_size": (int, None),
                 "save_low_resolution": (bool, None),
                 "low_resolution": (float, None),
                 "verbose" : (bool, None),
                 "points_per_image": (int, None),
                 "straightening_threshold": (float, None)}
    
    safe = True
    for key, value in config.items():
        data_type, secondary = type_dict[key]
        if not isinstance(value, data_type):
            safe = False
            raise TypeError("{} has incorrect type. Expected {}".format(key, data_type))
        if isinstance(secondary, list):
            if not value in secondary:
                safe = False
                raise TypeError("{} has an invalid value. Expected {}".format(key, secondary))
        if isinstance(secondary, type):
            if not all(isinstance(item, secondary) for item in value):
                safe = False
                raise TypeError("{} has incorrect type. Expected a list of {}".format(key, secondary))
    return safe, config

def adjust_config(base_config, image_directory, parent_directory):
    #########################################################
    #Add information to the config to provide flexibility   #
    #for running on a single directory or all subdirectories#
    #########################################################
    config = copy.deepcopy(base_config)
    config["image_directory"] = image_directory

    #################################################
    #Specify paths for intermediate and final output#
    #################################################
    output_dir = os.path.basename(os.path.normpath(config["image_directory"])) + '_output'
    config["output_path"] =  os.path.join(parent_directory, output_dir)
    config["final_mosaic_path"] = os.path.join(parent_directory, "final_mosaics")
    config["final_mosaic_name"] = "mosaic_" + os.path.basename(os.path.normpath(config["image_directory"])) + '.png'
    if not os.path.exists(config["final_mosaic_path"]):
        os.makedirs(config["final_mosaic_path"])

    ######################################################################
    #Configure logger and change level based on verbose setting in config#
    ######################################################################
    log_path = os.path.join(config["final_mosaic_path"],  os.path.basename(os.path.normpath(config["image_directory"])) + '.log')
    #Make log if it doesn't exist
    if not os.path.exists(log_path):
        open(log_path, 'a').close()
    logger = logging.getLogger(os.path.basename(os.path.normpath(config["image_directory"])))
    logger.setLevel(logging.DEBUG)  
    logger.propagate = False
    stream_handler = logging.StreamHandler()
    file_handler = logging.FileHandler(log_path, mode = 'w')
    if config["verbose"]:
        stream_handler.setLevel(logging.INFO)
        file_handler.setLevel(logging.DEBUG)
    else:
        stream_handler.setLevel(logging.WARNING)
        file_handler.setLevel(logging.INFO)
    log_format =  logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s')
    stream_format = logging.Formatter('%(name)s - %(levelname)s - %(message)s')
    stream_handler.setFormatter(stream_format)
    file_handler.setFormatter(log_format)
    logger.addHandler(stream_handler)
    logger.addHandler(file_handler)
    config["logger"] = logger
    
    ###########################
    #Get image paths and names#
    ###########################
    image_types = ('.png', '.PNG', '.jpg', '.JPG', '.jpeg', '.JPEG', '.tiff', 'tif', '.TIFF', '.TIF', '.gif', '.GIF', '.img', '.IMG')
    image_paths = [os.path.join(config["image_directory"], img_name)
                   for img_name in os.listdir(config["image_directory"])
                   if img_name.endswith(image_types)]
    config["image_paths"] = sorted_nicely(image_paths)
    config["logger"].info("Found {} images".format(len(image_paths)))
    if len(config["image_paths"]) < 2:
        raise ValueError("Insufficient images for stitching")
    config["image_names"] =  [os.path.basename(img_name) for img_name in config["image_paths"]]
    
    #############################################################
    #Recover the original image dimensions used for the panorama#
    #############################################################
    dummy_img = read_image(config["image_paths"][0], config)
    img_xdim, img_ydim = dummy_img.shape[1], dummy_img.shape[0]
    config["img_dims"] = (img_xdim, img_ydim)
    
    ##################################################
    #Set device after checking if GPU is cuda enabled#
    ##################################################
    config["device"] = torch.device(config["device"] if torch.cuda.is_available() and config["device"] == "cuda" else "cpu")
    
    ##########################################
    #Create dictionary for pixel registration#
    ##########################################
    config["registration"] = {}
    if config["GPS"]:
        gps_data = pd.read_csv(os.path.join(config["image_directory"], "gps.csv"),
                               usecols = ["image", "latitude", "longitude"])
        gps_data["x"] = np.zeros((len(gps_data)))
        gps_data["y"] = np.zeros((len(gps_data)))
        config["logger"].info("Found GPS data...")
        config["GPS_data"] = gps_data

    ####################################
    #Prepare directory to store outputs#
    ####################################
    if not os.path.exists(config["output_path"]):
        config["logger"].info("Creating {}".format(config["output_path"]))
        os.makedirs(config["output_path"])
    else:
        config["logger"].info("Deleting existing contents in {}".format(config["output_path"]))
        for root, dirs, files in os.walk(config["output_path"], topdown=False):
            for name in files:
                os.remove(os.path.join(root, name))
            for name in dirs:
                os.rmdir(os.path.join(root, name))
    return config

def run(config_path, cpu_count):
    ###################
    #Check config file#
    # #################
    start_time = time.perf_counter()
    safe, base_config = load_config(config_path)
    if not safe:
        print("Config file is not valid")
        return
    
    ##################################
    #For a single directory of images#
    ##################################
    if "image_directory" in base_config:
        if not os.path.exists(base_config["image_directory"]):
            print("Image directory: {} does not exist".format(base_config["image_directory"]))
            return
        parent_directory = os.path.dirname(os.path.normpath(base_config["image_directory"]))
        run_batches(base_config, base_config["image_directory"], parent_directory)
        
    ########################################################
    #Run across all directories if given a parent directory#
    ########################################################
    elif "parent_directory" in base_config:
        if not os.path.exists(base_config["parent_directory"]):
            print("Parent directory: {} does not exist".format(base_config["parent_directory"]))
            return
        subfolders = [ f.path for f in os.scandir(base_config["parent_directory"]) if f.is_dir()]
        print("Found ", len(subfolders), " subdirectories to process...")
        parent_directory = os.path.dirname(os.path.normpath(base_config["parent_directory"]))
        
        ###########################
        #Run in parallel with CPUs#
        ###########################
        if base_config["device"] == "multiprocessing":
            if cpu_count == 0:
                cpu_count = int(multiprocessing.cpu_count() - 1)
                if cpu_count < 2:
                    print("Insufficient CPUs to run in parallel")
                    return
                
            ###############################################
            #Create unique config files for each directory#
            ###############################################
            num_processes = min(cpu_count, len(subfolders))
            print("Proceeding with {} processes".format(num_processes))
            multiprocessing.set_start_method('spawn') #Since we check number of devices before starting the processes, this is not fork safe
            with multiprocessing.Pool(processes = num_processes) as pool:
                try:
                    results = pool.starmap(run_batches, zip(itertools.repeat(base_config), subfolders, itertools.repeat(parent_directory)))
                except KeyboardInterrupt:
                    print("Stopping processes")
                    pool.terminate()
                    
        ###########################################
        #Run each directory in series, can use GPU#
        ###########################################
        else:
            for image_directory in subfolders:
                run_batches(base_config, image_directory, parent_directory)      
    else:
        print("Specify either image_directory or parent_directory")
        
    ##########################
    #Print total elapsed time#
    ##########################
    end_time = time.perf_counter()
    elapsed_time = (end_time - start_time)/60
    print("Total elapsed time: {:.2f} minutes".format(elapsed_time))
    
if __name__ == "__main__":
    config_path = sys.argv[1]
    if len(sys.argv) > 2:
        cpu_count = int(sys.argv[2])
    else:
        cpu_count = 0
    run(config_path, cpu_count)