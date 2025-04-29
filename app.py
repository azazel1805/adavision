import os
import pathlib
import uuid # Make sure uuid is imported
import traceback # For detailed error logging
from flask import Flask, request, render_template, jsonify, send_from_directory # Added send_from_directory for PWA files
from werkzeug.utils import secure_filename
from dotenv import load_dotenv
import google.generativeai as genai
from PIL import Image
import io # Needed for handling image bytes

# Load environment variables
load_dotenv()

# Configure Flask app
app = Flask(__name__)
app.config['UPLOAD_FOLDER'] = 'uploads'
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024 # 16 MB upload limit
ALLOWED_EXTENSIONS = {'png', 'jpg', 'jpeg', 'gif', 'webp'}

# Create upload folder if it doesn't exist
pathlib.Path(app.config['UPLOAD_FOLDER']).mkdir(parents=True, exist_ok=True)

# Configure Gemini API
try:
    gemini_api_key = os.getenv("GEMINI_API_KEY")
    if not gemini_api_key:
        raise ValueError("GEMINI_API_KEY not found in .env file")
    genai.configure(api_key=gemini_api_key)
    # Consider latest models if available and suitable
    vision_model = genai.GenerativeModel('gemini-1.5-flash')
    text_model = genai.GenerativeModel('gemini-1.5-flash')
except ValueError as e:
    print(f"Error configuring Gemini: {e}")
    vision_model = None
    text_model = None
except Exception as e:
    print(f"An unexpected error occurred during Gemini configuration: {e}")
    vision_model = None
    text_model = None

# --- Helper Functions ---

def allowed_file(filename):
    """Checks if the file extension is allowed."""
    return '.' in filename and \
           filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

def process_uploaded_image(file_storage):
    """Validates, saves, opens, and returns image object and filepath."""
    if not file_storage or file_storage.filename == '':
        raise ValueError("No image selected or file name is empty.")

    if not allowed_file(file_storage.filename):
        raise ValueError(f"Invalid file type. Allowed: {', '.join(ALLOWED_EXTENSIONS)}")

    original_filename_parts = file_storage.filename.rsplit('.', 1)
    safe_base = secure_filename(original_filename_parts[0]) if len(original_filename_parts) > 1 else secure_filename(file_storage.filename)
    extension = original_filename_parts[1].lower() if len(original_filename_parts) > 1 else ''
    # Ensure extension is present if possible
    if not extension and '.' in file_storage.filename:
        extension = file_storage.filename.rsplit('.', 1)[1].lower()
    if not extension: # Fallback if no extension found
         raise ValueError("Could not determine file extension.")

    filename = f"{safe_base}_{uuid.uuid4()}.{extension}"
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)

    try:
        file_storage.save(filepath)
        img = Image.open(filepath)
        # Ensure image is in RGB format for consistency
        # Check if convert is necessary and possible
        if img.mode in ('RGBA', 'P', 'LA'): # Modes that can usually be converted
            img = img.convert('RGB')
        elif img.mode != 'RGB':
             print(f"Warning: Image mode {img.mode} might not be directly supported by API, attempting to use as is.")
             # Depending on API, might need error here or further conversion logic
        return img, filepath
    except Exception as e:
        if os.path.exists(filepath):
             try: os.remove(filepath)
             except Exception as cleanup_error: print(f"Nested error during cleanup: {cleanup_error}")
        # Provide more specific error if possible
        raise IOError(f"Error processing image file '{file_storage.filename}': {e}")


def safe_get_gemini_response(response):
    """Safely extracts text from Gemini response, checking candidates and parts."""
    try:
        if response.candidates and response.candidates[0].content.parts:
            return response.text.strip()
        else:
            # Log safety feedback if available
            safety_feedback = getattr(response, 'prompt_feedback', None)
            if safety_feedback and getattr(safety_feedback, 'block_reason', None):
                 print(f"Gemini content blocked: {safety_feedback.block_reason}")
                 return f"Error: Content blocked by safety settings ({safety_feedback.block_reason})."
            print("Gemini response missing candidates or parts.")
            return "Error: Received an empty or incomplete response from the model."
    except Exception as e:
        print(f"Error extracting Gemini response text: {e}")
        return "Error: Could not process the model's response."


# --- Routes ---

@app.route('/')
def index():
    """Renders the main HTML page."""
    return render_template('index.html')

# --- Routes for PWA Files (served from root) ---
@app.route('/service-worker.js')
def service_worker():
    try:
        return send_from_directory('static', 'service-worker.js', mimetype='application/javascript')
    except FileNotFoundError:
        return "Service worker not found.", 404

@app.route('/manifest.json')
def manifest():
     try:
        return send_from_directory('static', 'manifest.json', mimetype='application/manifest+json')
     except FileNotFoundError:
         return "Manifest not found.", 404

# --- API Routes ---

@app.route('/analyze', methods=['POST'])
def analyze_image():
    """Handles text extraction and translation."""
    if not vision_model or not text_model:
         return jsonify({"error": "Gemini API not configured correctly."}), 500
    if 'image' not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files['image']
    target_language = request.form.get('language', 'english')
    img = None
    filepath = None
    try:
        img, filepath = process_uploaded_image(file)
        print(f"Analyzing image for text: {filepath}")
        extraction_prompt = "Extract all visible text from this image. If no text is present, respond with 'No text found.'."
        extraction_response = vision_model.generate_content([extraction_prompt, img], stream=False); extraction_response.resolve()
        extracted_text = safe_get_gemini_response(extraction_response)
        print(f"Extracted text: {extracted_text}")

        translated_text = ""
        if extracted_text and extracted_text != "No text found." and not extracted_text.startswith("Error:"):
            print(f"Translating to: {target_language}")
            translation_prompt = f"Translate the following text to {target_language}: '{extracted_text}'"
            translation_response = text_model.generate_content(translation_prompt, stream=False); translation_response.resolve()
            translated_text = safe_get_gemini_response(translation_response)
            print(f"Translated text: {translated_text}")
        elif extracted_text == "No text found.":
            translated_text = "No text to translate."
        else:
            translated_text = "Translation not possible due to extraction error."

        return jsonify({"extracted_text": extracted_text, "translated_text": translated_text, "target_language": target_language})

    except (ValueError, IOError) as e:
        print(f"File processing error in /analyze: {e}")
        # Check if filepath exists before attempting to remove
        if 'filepath' in locals() and filepath and not os.path.exists(filepath): filepath = None
        return jsonify({"error": str(e)}), 400
    except genai.types.generation_types.BlockedPromptException as e:
         print(f"Gemini API Error (Blocked Prompt) in /analyze: {e}"); return jsonify({"error": f"Content blocked by API safety settings."}), 500
    except Exception as e:
        print(f"An unexpected error occurred during analysis: {e}"); traceback.print_exc(); return jsonify({"error": "An internal server error occurred during analysis"}), 500
    finally:
        if 'filepath' in locals() and filepath and os.path.exists(filepath):
            try: os.remove(filepath); print(f"Deleted image after analysis: {filepath}")
            except Exception as cleanup_e: print(f"Error cleaning up file {filepath} after analysis: {cleanup_e}")


@app.route('/identify', methods=['POST'])
def identify_route():
    """Handles object identification."""
    if not vision_model: return jsonify({"error": "Gemini Vision API not configured correctly."}), 500
    if 'image' not in request.files: return jsonify({"error": "No image file provided"}), 400

    file = request.files['image']; img = None; filepath = None
    try:
        img, filepath = process_uploaded_image(file)
        print(f"Identifying objects in image: {filepath}")
        identification_prompt = "Describe the main objects and overall scene shown in this image in a concise paragraph."
        response = vision_model.generate_content([identification_prompt, img], stream=False); response.resolve()
        identified_objects_text = safe_get_gemini_response(response)
        print(f"Identified objects/scene: {identified_objects_text}")
        return jsonify({"identified_objects": identified_objects_text})

    except (ValueError, IOError) as e:
        print(f"File processing error in /identify: {e}")
        if 'filepath' in locals() and filepath and not os.path.exists(filepath): filepath = None
        return jsonify({"error": str(e)}), 400
    except genai.types.generation_types.BlockedPromptException as e:
         print(f"Gemini API Error (Blocked Prompt) in /identify: {e}"); return jsonify({"error": f"Content blocked by API safety settings."}), 500
    except Exception as e:
        print(f"An unexpected error occurred during identification: {e}"); traceback.print_exc(); return jsonify({"error": "An internal server error occurred during identification"}), 500
    finally:
        if 'filepath' in locals() and filepath and os.path.exists(filepath):
            try: os.remove(filepath); print(f"Deleted image after identification: {filepath}")
            except Exception as cleanup_e: print(f"Error cleaning up file {filepath} after identification: {cleanup_e}")


@app.route('/correct_text', methods=['POST'])
def correct_text_route():
    """Analyzes and corrects provided text."""
    if not text_model: return jsonify({"error": "Gemini Text API not configured correctly."}), 500
    if not request.is_json: return jsonify({"error": "Request must be JSON"}), 400

    data = request.get_json()
    text_to_correct = data.get('text')
    if not text_to_correct: return jsonify({"error": "No 'text' field provided in JSON body"}), 400

    try:
        print(f"Analyzing text for corrections: '{text_to_correct[:100]}...'")
        correction_prompt = f"""Please analyze the following text for grammatical errors, spelling mistakes, awkward phrasing, and clarity. Provide only the corrected version of the text. If the text appears correct and does not require changes, respond with the exact phrase "No corrections needed.".

Original Text:
'{text_to_correct}'

Corrected Text:"""
        response = text_model.generate_content(correction_prompt, stream=False); response.resolve()
        corrected_text_result = safe_get_gemini_response(response)
        print(f"Correction result: {corrected_text_result}")
        return jsonify({"corrected_text": corrected_text_result})

    except genai.types.generation_types.BlockedPromptException as e:
         print(f"Gemini API Error (Blocked Prompt) in /correct_text: {e}"); return jsonify({"error": f"Content blocked by API safety settings."}), 500
    except Exception as e:
        print(f"An unexpected error occurred during text correction: {e}"); traceback.print_exc(); return jsonify({"error": "An internal server error occurred during text correction"}), 500


@app.route('/estimate_age', methods=['POST'])
def estimate_age_route():
    """Estimates the apparent age of people in the image."""
    if not vision_model:
        return jsonify({"error": "Gemini Vision API not configured correctly."}), 500

    if 'image' not in request.files:
        return jsonify({"error": "No image file provided"}), 400

    file = request.files['image']
    img = None
    filepath = None

    try:
        img, filepath = process_uploaded_image(file) # Reuse helper
        print(f"Estimating age in image: {filepath}")

        # Prompt specifically for apparent age estimation
        age_prompt = """Analyze the image and estimate the apparent age range of the most prominent person visible. If multiple people are clearly visible, provide estimates for each if possible. If no person is clearly visible or identifiable, please state 'No person detected for age estimation.' Be concise."""

        response = vision_model.generate_content([age_prompt, img], stream=False)
        response.resolve() # Ensure completion

        estimated_age_text = safe_get_gemini_response(response) # Use safe helper
        print(f"Age estimation result: {estimated_age_text}")

        return jsonify({
            "estimated_age": estimated_age_text
        })

    except (ValueError, IOError) as e: # Catch specific errors from helper
        print(f"File processing error in /estimate_age: {e}")
        if 'filepath' in locals() and filepath and not os.path.exists(filepath): filepath = None
        return jsonify({"error": str(e)}), 400
    except genai.types.generation_types.BlockedPromptException as e:
         print(f"Gemini API Error (Blocked Prompt) in /estimate_age: {e}")
         return jsonify({"error": f"Content blocked by API safety settings."}), 500
    except Exception as e:
        print(f"An unexpected error occurred during age estimation: {e}")
        traceback.print_exc()
        return jsonify({"error": "An internal server error occurred during age estimation"}), 500
    finally:
        # --- Cleanup ---
        if 'filepath' in locals() and filepath and os.path.exists(filepath):
            try:
                os.remove(filepath)
                print(f"Deleted image after age estimation: {filepath}")
            except Exception as cleanup_e:
                print(f"Error cleaning up file {filepath} after age estimation: {cleanup_e}")


# --- Main Execution Block ---
if __name__ == '__main__':
    # debug=True is fine for local development
    # Render/Gunicorn will ignore this block when running in production.
    app.run(debug=True)
