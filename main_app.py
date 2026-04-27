import base64
import json
import os
from io import BytesIO
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from openai import OpenAI
from PIL import Image
import pillow_heif


load_dotenv()
pillow_heif.register_heif_opener()

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

MAX_IMAGE_BYTES = 20 * 1024 * 1024  # 20MB hard limit


def normalize_weight_inputs(
    mode: str,
    gross_weight_g: Optional[float],
    net_weight_g: Optional[float],
) -> dict:
    valid_modes = {"image_only", "gross_weight", "net_weight"}

    if mode not in valid_modes:
        raise HTTPException(status_code=400, detail="Invalid mode.")

    if mode == "image_only":
        if gross_weight_g is not None or net_weight_g is not None:
            raise HTTPException(
                status_code=400,
                detail="Weight must not be provided in image_only mode.",
            )
        return {"mode": mode, "weight_type": None, "weight_g": None}

    if mode == "gross_weight":
        if gross_weight_g is None:
            raise HTTPException(status_code=400, detail="gross_weight_g is required.")
        return {"mode": mode, "weight_type": "gross", "weight_g": gross_weight_g}

    if net_weight_g is None:
        raise HTTPException(status_code=400, detail="net_weight_g is required.")
    return {"mode": mode, "weight_type": "net", "weight_g": net_weight_g}


def build_weight_context(normalized: dict) -> str:
    mode = normalized["mode"]
    weight_g = normalized["weight_g"]

    if mode == "image_only":
        return "No weight information is available."

    if mode == "gross_weight":
        return f"Gross weight is {weight_g} g. Includes plate/container. Edible weight is lower."

    return f"Net weight is {weight_g} g of edible food, in the state presented in the image."


def _is_heic_bytes(data: bytes) -> bool:
    """
    Detect HEIC/HEIF by magic bytes regardless of MIME type.
    HEIC files have 'ftyp' at offset 4, followed by brand like 'heic', 'heix', 'mif1', etc.
    """
    if len(data) < 12:
        return False
    ftyp_marker = data[4:8]
    brand = data[8:12]
    heic_brands = {b"heic", b"heix", b"hevc", b"hevx", b"mif1", b"msf1", b"avif"}
    return ftyp_marker == b"ftyp" and brand in heic_brands


def preprocess_image(upload: UploadFile, image_bytes: bytes) -> tuple[bytes, str]:
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Image too large. Maximum size is {MAX_IMAGE_BYTES // (1024 * 1024)}MB.",
        )

    content_type = (upload.content_type or "").lower().strip()
    filename = (upload.filename or "").lower()

    # Detect HEIC by magic bytes first — mobile clients (Expo, Safari iOS)
    # often send HEIC as 'application/octet-stream' or with no content type.
    is_heic = _is_heic_bytes(image_bytes)

    supported_types = {
        "image/jpeg",
        "image/jpg",
        "image/png",
        "image/heic",
        "image/heif",
        "application/octet-stream",  # allow passthrough; magic bytes check handles validation
    }
    supported_exts = (".jpg", ".jpeg", ".png", ".heic", ".heif")

    mime_ok = content_type in supported_types or not content_type
    ext_ok = filename.endswith(supported_exts) or not filename
    format_known = is_heic or mime_ok or ext_ok

    if not format_known:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported format. Use JPEG, PNG or HEIC/HEIF. Received content-type: '{upload.content_type}'",
        )

    try:
        if is_heic:
            # Explicitly decode via pillow_heif to avoid any Pillow ambiguity
            heif_file = pillow_heif.read_heif(image_bytes)
            img = Image.frombytes(
                heif_file.mode,
                heif_file.size,
                heif_file.data,
                "raw",
            )
        else:
            img = Image.open(BytesIO(image_bytes))
            img.load()  # Force full decode immediately — catches corrupt files early

        # Strip alpha / palette / CMYK before any resize
        if img.mode not in ("RGB",):
            img = img.convert("RGB")

        # Work on a copy so the original EXIF/palette data doesn't interfere
        img = img.copy()

        # Resize: keep longest side ≤ 1024px
        img.thumbnail((1024, 1024), Image.LANCZOS)

        buffer = BytesIO()
        img.save(buffer, format="JPEG", quality=85, optimize=True)
        buffer.seek(0)

        return buffer.getvalue(), "image/jpeg"

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to process image: {str(e)}")


@app.get("/")
def root():
    return {"message": "API is running"}


@app.post("/estimate-image")
async def estimate_image(
    image: UploadFile = File(...),
    mode: str = Form(...),
    gross_weight_g: Optional[float] = Form(None),
    net_weight_g: Optional[float] = Form(None),
    icr: float = Form(10),
):
    normalized = normalize_weight_inputs(mode, gross_weight_g, net_weight_g)

    image_bytes = await image.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Empty file.")

    final_image_bytes, final_mime_type = preprocess_image(image, image_bytes)

    image_base64 = base64.b64encode(final_image_bytes).decode("utf-8")
    data_url = f"data:{final_mime_type};base64,{image_base64}"

    weight_context = build_weight_context(normalized)

    prompt = f"""
Rules: Return valid JSON only. No markdown. No extra text.
{weight_context}

Task:
1. Decide if image contains food.
2. If no food, return ONLY {{"status":"not_food"}}
3. If the image contains food, estimate the total carbohydrates in grams (carbs_g) and return exactly:
{{"status":"food","carbs_g":number}}



4. In this image, the food is on a circular plate with a diameter of 26,5 cm.





 You must reconcile the visual volume of the food with the provided weight information, if available, as well as using all of the available information at your disposal, and making use of the best methods and practices. 
The inference should reflect a realistic carbohydrate-to-mass ratio for the identified ingredients.


"""

    try:
        response = client.chat.completions.create(


            model="gpt-5.4",
            
            temperature=0,


            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {"url": data_url},
                        },
                    ],
                }
            ],
            max_completion_tokens=60,
            response_format={"type": "json_object"},
            timeout=30,  # prevent silent hangs on large payloads
        )

        content = response.choices[0].message.content
        print("OpenAI raw response:", content)

        data = json.loads(content)

      
        if data.get("status") == "food" and "carbs_g" in data:
            carbs_g = float(data["carbs_g"])
            data["carbs_g"] = carbs_g

            if icr <= 0:
                data["bolus_iu"] = 0.0
            else:
                data["bolus_iu"] = round(carbs_g / float(icr), 2)

        return data

    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail="OpenAI returned invalid JSON.")
    except (ValueError, TypeError):
        raise HTTPException(status_code=502, detail="OpenAI returned invalid numeric values.")
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"OpenAI error: {str(e)}")