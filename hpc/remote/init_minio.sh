
#!/bin/sh
# Port-aware copy of backend/gemini/storage/scripts/init_minio.sh: on a shared
# HPC node MinIO cannot assume port 9000 (MINIO_SERVER_PORT).
set -e

# Runs on every stack start, so every step must be safe to repeat.
# Never echo the keys: this output lands in the container log.
echo "Connecting to MinIO at ${MINIO_SERVER_HOST}:${MINIO_SERVER_PORT:-9000} ..."
for i in $(seq 1 60); do
    if mc alias set local "http://${MINIO_SERVER_HOST}:${MINIO_SERVER_PORT:-9000}" "${MINIO_ACCESS_KEY}" "${MINIO_SECRET_KEY}" >/dev/null 2>&1; then
        break
    fi
    if [ "$i" -eq 60 ]; then
        echo "MinIO did not come up within 60 s" >&2
        exit 1
    fi
    sleep 1
done

# Create a service account
echo "Creating service account..."
mc admin user add local "${GEMINI_STORAGE_ACCESS_KEY}" "${GEMINI_STORAGE_SECRET_KEY}" >/dev/null

# Create a policy file
echo "Creating policy file..."
POLICY_FILE="/tmp/policy.json"
cat << EOF > "${POLICY_FILE}"
{
    "Version": "2012-10-17",
    "Statement": [{
        "Effect": "Allow",
        "Action": [
            "s3:CreateBucket",
            "s3:DeleteBucket",
            "s3:GetObject",
            "s3:DeleteObject",
            "s3:PutObject",
            "s3:ListBucket",
            "s3:List*",
            "s3:GetBucketLocation",
            "s3:AbortMultipartUpload",
            "s3:ListBucketMultipartUploads",
            "s3:ListMultipartUploadParts"
        ],
        "Resource": [
            "arn:aws:s3:::${GEMINI_STORAGE_BUCKET_NAME}",
            "arn:aws:s3:::${GEMINI_STORAGE_BUCKET_NAME}/*",
            "arn:aws:s3:::staged-downloads/*",
            "arn:aws:s3:::staged-uploads/*"    
        ]
    }]
}
EOF

# Add policy with verbose output
echo "Adding policy..."
mc admin policy create local gemini-service-policy "${POLICY_FILE}"

# Show policy
echo "Showing policy info..."
mc admin policy info local gemini-service-policy

# Clean up temporary policy file
rm -f "${POLICY_FILE}"

# Assign policy to service account
echo "Assigning policy to service account..."
mc admin policy attach local gemini-service-policy --user "${GEMINI_STORAGE_ACCESS_KEY}" \
    || echo "(policy already attached)"

# Create bucket if it doesn't exist
echo "Creating bucket..."
mc mb --ignore-existing local/"${GEMINI_STORAGE_BUCKET_NAME}"

# Create 'staged-downloads' bucket if it doesn't exist
if ! mc ls local/"staged-downloads" >/dev/null 2>&1; then
    echo "Creating 'staged-downloads' bucket..."
    mc mb local/"staged-downloads"
else
    echo "'staged-downloads' bucket already exists."
fi

# Create 'staged-uploads' bucket if it doesn't exist
if ! mc ls local/"staged-uploads" >/dev/null 2>&1; then
    echo "Creating 'staged-uploads' bucket..."
    mc mb local/"staged-uploads"
else
    echo "'staged-uploads' bucket already exists."
fi



# No anonymous access. Everything reads with credentials (the API, the
# workers, TiTiler); an anonymous "download" policy let anyone who could
# reach MinIO's port read every file without a password.
mc anonymous set none local/"${GEMINI_STORAGE_BUCKET_NAME}"
mc anonymous set none local/"staged-downloads"
mc anonymous set none local/"staged-uploads"


echo "MinIO initialization completed successfully"
