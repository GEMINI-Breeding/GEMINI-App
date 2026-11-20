"""Experiment: can the model read one boundary offset from one large tile?"""
import base64, io, json, re, sys, urllib.request
from PIL import Image, ImageDraw
from gemi_agent import tools
from gemi_agent.panorama import Panorama
from gemi_agent.runner import load_config

T = "Raw/2026/GEMINI/Coachella/Lima/2026-09-17/Amiga/RGB/c0fca235/"
tr = tools._track({"track": T}); p = tr.passes()[59]; pano = Panorama(tr, p["first"], p["last"])
old = [974,1694,2366,3038,3710,4382,5054,5726,6470,7070,7763,8483,9155,9851,10511,11228,11876,12572,13268]
truth = [65,10,0,20,20,30,30,20,-15,10,5,5,-25,-45,-35,-55,-70,-80,-90]
cfg = load_config(); raw = Image.open(pano.raw_path); H = pano.height
band = (0.5, 1.0); reach, zoom = 160, 5

def tile(x):
    crop = raw.crop((x - reach, int(H*band[0]), x + reach, int(H*band[1]))).resize((2*reach*zoom, int(H*(band[1]-band[0]))*zoom), Image.LANCZOS)
    out = Image.new("RGB", (crop.width, crop.height + 40), (0, 0, 0)); out.paste(crop, (0, 40)); d = ImageDraw.Draw(out)
    for off in range(-150, 151, 25):
        px = (off + reach) * zoom
        d.line((px, 26, px, 40), fill=(255, 255, 0), width=2)
        if off % 50 == 0: d.text((px - 14, 4), f"{off:+d}" if off else "0", fill=(255, 255, 0), font_size=18)
        d.line((px, 40, px, out.height), fill=(255, 255, 0, 60), width=1) if off % 50 == 0 else None
    return out

def ask(img):
    b = io.BytesIO(); img.save(b, "JPEG", quality=88)
    q = ("Top-down photo strip of a crop bed. Somewhere in it a wooden stake (a tan/yellow slat, sometimes lying at an "
         "angle, often with a dab of white paint on the soil) marks a plot boundary. The yellow ruler along the top "
         "gives horizontal offsets; thin vertical yellow lines mark -150, -100, -50, 0, +50, +100, +150.\n"
         "Find the point where the stake goes into the ground. Answer with JSON only: "
         '{"stake_visible": true|false, "offset": <integer ruler value>, "what_you_see": "<10 words>"}')
    body = {"model": cfg["model"], "temperature": 0, "max_tokens": 120, "messages": [{"role": "user", "content": [
        {"type": "text", "text": q},
        {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + base64.b64encode(b.getvalue()).decode()}}]}]}
    r = urllib.request.Request(cfg["base_url"] + "/chat/completions", data=json.dumps(body).encode(),
                               headers={"Content-Type": "application/json", "Authorization": "Bearer " + cfg["api_key"]})
    return json.load(urllib.request.urlopen(r, timeout=300))["choices"][0]["message"]["content"]

errs = []
for i in (range(19) if len(sys.argv) < 2 else [int(a) for a in sys.argv[1:]]):
    img = tile(old[i]); img.save(f"work/exp_tile_{i}.png")
    ans = ask(img); m = re.search(r'"offset"\s*:\s*(-?\d+)', ans)
    got = int(m.group(1)) if m else None
    errs.append(None if got is None else got - truth[i])
    print(i, "truth", truth[i], "model", got, "|", ans.replace("\n", " ")[:110])
ok = [abs(e) for e in errs if e is not None]
print("abs err: median", sorted(ok)[len(ok)//2], "max", max(ok), "within 20px:", sum(e <= 20 for e in ok), "of", len(errs))
