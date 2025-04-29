document.addEventListener('DOMContentLoaded', () => {
    // --- Get DOM Elements ---
    const imageInput = document.getElementById('imageInput');
    const languageSelect = document.getElementById('languageSelect');
    const analyzeButton = document.getElementById('analyzeButton');
    const imagePreview = document.getElementById('imagePreview');
    const previewArea = document.getElementById('previewArea');
    const extractedTextElem = document.getElementById('extractedText');
    const translatedTextElem = document.getElementById('translatedText');
    const translationLabelElem = document.getElementById('translationLabel');
    const resultsArea = document.getElementById('resultsArea'); // Text results tab pane
    const loadingElem = document.getElementById('loading');
    const errorArea = document.getElementById('errorArea');
    const errorMessageElem = document.getElementById('errorMessage');
    const fileLabel = document.querySelector('.file-label');

    // Camera related elements
    const startCameraButton = document.getElementById('startCameraButton');
    const cameraArea = document.getElementById('cameraArea');
    const videoElement = document.getElementById('videoElement');
    const snapButton = document.getElementById('snapButton');
    const cancelCameraButton = document.getElementById('cancelCameraButton');
    const canvasElement = document.getElementById('canvasElement');
    const inputOptions = document.querySelector('.input-options');

    // Feature Elements
    const copyButtons = document.querySelectorAll('.copy-button');
    const speakButton = document.getElementById('speakButton');
    const identifyObjectsButton = document.getElementById('identifyObjectsButton');
    const objectsArea = document.getElementById('objectsArea'); // Objects tab pane
    const identifiedObjectsText = document.getElementById('identifiedObjectsText');
    const loadingText = document.getElementById('loadingText');
    const analyzeCorrectButton = document.getElementById('analyzeCorrectButton');
    const correctionArea = document.getElementById('correctionArea'); // Correction result box (inside resultsArea pane)
    const correctedTextElem = document.getElementById('correctedText');
    const estimateAgeButton = document.getElementById('estimateAgeButton');
    const ageEstimateArea = document.getElementById('ageEstimateArea'); // Age tab pane
    const ageEstimateText = document.getElementById('ageEstimateText');

    // Tab Elements
    const tabNavigation = document.querySelector('.tab-navigation');
    const tabButtons = document.querySelectorAll('.tab-button');
    const tabPanes = document.querySelectorAll('.tab-pane'); // Select all panes

    // --- State Variables ---
    let currentFile = null;
    let currentStream = null;
    let currentTranslationLanguage = null;

    // --- Language Mapping for TTS ---
    const languageCodeMap = {
        'english': 'en-US', 'spanish': 'es-ES', 'french': 'fr-FR',
        'german': 'de-DE', 'turkish': 'tr-TR', 'italian': 'it-IT',
        'portuguese': 'pt-PT', 'japanese': 'ja-JP', 'russian': 'ru-RU'
    };

    // --- Event Listeners ---
    imageInput.addEventListener('change', (event) => {
        const files = event.target.files;
        if (files && files[0]) handleFileSelect(files[0]);
        else if (!currentFile) resetState();
    });
    startCameraButton.addEventListener('click', startCamera);
    snapButton.addEventListener('click', takeSnapshot);
    cancelCameraButton.addEventListener('click', stopCameraStream);
    analyzeButton.addEventListener('click', analyzeImage);
    identifyObjectsButton.addEventListener('click', identifyObjects);
    analyzeCorrectButton.addEventListener('click', analyzeAndCorrectText);
    estimateAgeButton.addEventListener('click', estimateAge);
    copyButtons.forEach(button => button.addEventListener('click', handleCopyClick));
    speakButton.addEventListener('click', handleSpeakClick);
    // Tab Navigation Listener
    if (tabNavigation) {
        tabNavigation.addEventListener('click', (event) => {
            if (event.target.matches('.tab-button')) {
                const targetPaneId = event.target.dataset.target;
                activateTab(targetPaneId);
            }
        });
    }

    // --- Core Functions ---

    function handleFileSelect(file) {
        stopCameraStream();
        currentFile = file;
        const reader = new FileReader();
        reader.onload = function(e) {
            imagePreview.src = e.target.result;
            previewArea.style.display = 'block';
            hideResultAreasAndTabs(false); // Keep preview, hide results & tabs
            cameraArea.style.display = 'none';
            inputOptions.style.display = 'flex';
            enableActionButtons(true);
        }
        reader.readAsDataURL(currentFile);
    }

    async function startCamera() {
        hideResultAreasAndTabs(true); // Hide all results including preview & tabs
        errorArea.style.display = 'none';
        currentFile = null;
        enableActionButtons(false);

        if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
                currentStream = stream;
                videoElement.srcObject = stream;
                videoElement.onloadedmetadata = () => { videoElement.play(); };
                cameraArea.style.display = 'block';
                inputOptions.style.display = 'none';
            } catch (err) {
                console.error("Error accessing camera:", err);
                let userMessage = `Could not access the camera. Error: ${err.name}. Ensure permission granted.`;
                showError(userMessage);
                stopCameraStream();
            }
        } else {
            showError("Camera access is not supported by your browser.");
            stopCameraStream();
        }
    }

    function takeSnapshot() {
        if (!currentStream || !videoElement.videoWidth) return;
        const context = canvasElement.getContext('2d');
        canvasElement.width = videoElement.videoWidth;
        canvasElement.height = videoElement.videoHeight;
        context.drawImage(videoElement, 0, 0, canvasElement.width, canvasElement.height);

        canvasElement.toBlob(async (blob) => {
             if (blob) {
                const fileName = `snapshot-${Date.now()}.jpg`;
                currentFile = new File([blob], fileName, { type: 'image/jpeg' });
                if (imagePreview.src.startsWith('blob:')) URL.revokeObjectURL(imagePreview.src);
                imagePreview.src = URL.createObjectURL(currentFile);
                previewArea.style.display = 'block';
                enableActionButtons(true);
                hideResultAreasAndTabs(false); // Keep preview, hide results & tabs
                stopCameraStream();
             } else {
                showError("Failed to capture snapshot.");
                stopCameraStream();
             }
        }, 'image/jpeg', 0.9);
    }

    function stopCameraStream() {
        if (currentStream) {
            currentStream.getTracks().forEach(track => track.stop());
            currentStream = null;
        }
        videoElement.srcObject = null;
        videoElement.onloadedmetadata = null;
        cameraArea.style.display = 'none';
        inputOptions.style.display = 'flex';
        enableActionButtons(!!currentFile);
    }

    async function analyzeImage() { // Text analysis and translation
        if (!currentFile) { showError("Please select or capture an image first."); return; }
        const selectedLanguage = languageSelect.value;
        const formData = new FormData();
        formData.append('image', currentFile, currentFile.name);
        formData.append('language', selectedLanguage);

        setLoadingState(true, 'Analyzing Text & Translating...');
        // Don't hide areas here, activateTab will handle it

        try {
            const response = await fetch('/analyze', { method: 'POST', body: formData });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Server error ${response.status}`);

            extractedTextElem.textContent = result.extracted_text || 'No text content received.';
            translatedTextElem.textContent = result.translated_text || 'No translation received.';
            translationLabelElem.innerHTML = `<i class="fa-solid fa-language"></i> Translated Text (${capitalizeFirstLetter(result.target_language || 'Unknown')}):`;
            currentTranslationLanguage = result.target_language;

            const hasExtractedText = result.extracted_text && result.extracted_text !== "No text found." && !result.extracted_text.startsWith("Error:");
            updateCorrectionButtonState(hasExtractedText);

            speakButton.style.display = (result.translated_text && result.translated_text !== "No text to translate." && !result.translated_text.startsWith("Error:")) ? 'inline-flex' : 'none';

            activateTab('resultsArea'); // Activate this tab

        } catch (error) {
            console.error("Error during text analysis:", error);
            showError(`Text analysis failed: ${error.message}`);
            currentTranslationLanguage = null;
            updateCorrectionButtonState(false);
            speakButton.style.display = 'none';
        } finally {
            setLoadingState(false);
        }
    }

    async function identifyObjects() { // Object identification
        if (!currentFile) { showError("Please select or capture an image first."); return; }
        const formData = new FormData();
        formData.append('image', currentFile, currentFile.name);

        setLoadingState(true, 'Identifying Objects...');
        // Don't hide areas here, activateTab will handle it

        try {
            const response = await fetch('/identify', { method: 'POST', body: formData });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Server error ${response.status}`);

            identifiedObjectsText.textContent = result.identified_objects || 'No objects identified or described.';
            activateTab('objectsArea'); // Activate this tab

        } catch (error) {
            console.error("Error during object identification:", error);
            showError(`Object identification failed: ${error.message}`);
        } finally {
            setLoadingState(false);
        }
    }

    async function analyzeAndCorrectText() { // Correct extracted text
        const textToCorrect = extractedTextElem.textContent;
        if (!textToCorrect || textToCorrect === "No text found." || textToCorrect.startsWith("Error:")) {
            showError("No valid extracted text available to analyze."); return;
        }
        analyzeCorrectButton.disabled = true; // Disable immediately
        // Use a slightly different loading message maybe?
        setLoadingState(true, 'Checking text...');
        correctionArea.style.display = 'none'; // Hide previous correction

        try {
            const response = await fetch('/correct_text', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: textToCorrect }), });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Server error ${response.status}`);

            correctedTextElem.textContent = result.corrected_text || 'No correction suggestions provided.';
            correctionArea.style.display = result.corrected_text ? 'block' : 'none';
            // Ensure the Text Analysis tab is still active
            activateTab('resultsArea');

        } catch (error) {
            console.error("Error during text correction:", error);
            showError(`Text correction failed: ${error.message}`);
            correctionArea.style.display = 'none';
        } finally {
            setLoadingState(false);
            // Re-evaluate button state based on original text
            updateCorrectionButtonState(!!extractedTextElem.textContent && extractedTextElem.textContent !== "No text found." && !extractedTextElem.textContent.startsWith("Error:"));
        }
    }

    async function estimateAge() { // Estimate Age
        if (!currentFile) { showError("Please select or capture an image first."); return; }
        const formData = new FormData();
        formData.append('image', currentFile, currentFile.name);

        setLoadingState(true, 'Estimating Age...');
        // Don't hide areas here, activateTab will handle it

        try {
            const response = await fetch('/estimate_age', { method: 'POST', body: formData });
            const result = await response.json();
            if (!response.ok) throw new Error(result.error || `Server error ${response.status}`);

            ageEstimateText.textContent = result.estimated_age || 'Could not estimate age.';
            activateTab('ageEstimateArea'); // Activate this tab

        } catch (error) {
            console.error("Error during age estimation:", error);
            showError(`Age estimation failed: ${error.message}`);
        } finally {
            setLoadingState(false);
        }
    }

    // --- Tab Switching Logic ---
    function activateTab(targetPaneId) {
        if (!targetPaneId) return;

        let paneActivated = false;
        if (tabNavigation.style.display === 'none') {
             tabNavigation.style.display = 'flex'; // Show tabs if hidden
        }

        tabPanes.forEach(pane => {
            const isActive = pane.id === targetPaneId;
            pane.classList.toggle('active', isActive);
            pane.style.display = isActive ? 'block' : 'none';
            if(isActive) paneActivated = true;
        });
        tabButtons.forEach(button => {
             button.classList.toggle('active', button.dataset.target === targetPaneId);
        });

        // Hide correction area unless the main text tab is active AND correction exists
        if (targetPaneId !== 'resultsArea' && correctionArea) {
             correctionArea.style.display = 'none';
        } else if (targetPaneId === 'resultsArea' && correctedTextElem.textContent) {
             correctionArea.style.display = 'block';
        }
    }

    // --- UI State Helpers ---
    function setLoadingState(isLoading, message = 'Processing...') {
        loadingText.textContent = message;
        loadingElem.style.display = isLoading ? 'block' : 'none';

        const elementsToDisable = [analyzeButton, identifyObjectsButton, estimateAgeButton, analyzeCorrectButton, startCameraButton, imageInput, fileLabel, languageSelect, snapButton, cancelCameraButton];
        elementsToDisable.forEach(el => { if(el) el.disabled = isLoading; });
        if (fileLabel) fileLabel.style.pointerEvents = isLoading ? 'none' : 'auto';

        speakButton.style.display = 'none';
        if (isLoading) {
            updateCorrectionButtonState(false); // Always disable/hide correct button during loading
            errorArea.style.display = 'none';
            // Don't hide panes here, let activateTab handle visibility after success
        } else {
            // Re-enable main buttons after loading based on file state
            enableActionButtons(!!currentFile);
            // Re-evaluate correction button state based on *current* state
            const currentActivePane = document.querySelector('.tab-pane.active');
            const isTextPaneActive = currentActivePane && currentActivePane.id === 'resultsArea';
            if (isTextPaneActive) {
                updateCorrectionButtonState(!!extractedTextElem.textContent && extractedTextElem.textContent !== "No text found." && !extractedTextElem.textContent.startsWith("Error:"));
            } else {
                updateCorrectionButtonState(false);
            }
        }
    }

    function enableActionButtons(enabled) { // Enables Analyze, Identify & Estimate Age
        analyzeButton.disabled = !enabled;
        identifyObjectsButton.disabled = !enabled;
        estimateAgeButton.disabled = !enabled;
    }

    function updateCorrectionButtonState(enabled) {
        analyzeCorrectButton.disabled = !enabled;
        analyzeCorrectButton.style.display = enabled ? 'inline-flex' : 'none';
    }

    function hideResultAreasAndTabs(hidePreview = true) {
         // Hides all result sections and the tab navigation
         if(hidePreview) previewArea.style.display = 'none';
         tabPanes.forEach(pane => {
             pane.classList.remove('active');
             pane.style.display = 'none';
         });
         tabButtons.forEach(button => button.classList.remove('active'));
         if (tabNavigation) tabNavigation.style.display = 'none'; // Hide tabs completely

         // Also hide buttons related to these areas
         speakButton.style.display = 'none';
         analyzeCorrectButton.style.display = 'none';
    }

    // --- Feature Handlers ---
    function handleCopyClick(event) {
        const button = event.currentTarget;
        const targetId = button.dataset.target;
        const targetElement = document.getElementById(targetId);

        if (targetElement) {
            const textToCopy = targetElement.textContent?.trim();
            if (!textToCopy) return;

            navigator.clipboard.writeText(textToCopy).then(() => {
                const originalHTML = button.innerHTML;
                button.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
                button.disabled = true;
                button.classList.add('copied-feedback');
                setTimeout(() => {
                    if (button.classList.contains('copied-feedback')) {
                         button.innerHTML = originalHTML;
                         button.disabled = false;
                         button.classList.remove('copied-feedback');
                    }
                }, 1800);
            }).catch(err => {
                console.error("Clipboard copy failed:", err);
                showError("Could not copy text. Please try manually.");
            });
        }
    }

    function handleSpeakClick() {
        if (!('speechSynthesis' in window)) {
            showError("Sorry, Text-to-Speech is not supported by this browser."); return;
        }
        const textToSpeak = translatedTextElem.textContent?.trim();
        if (!textToSpeak || !currentTranslationLanguage) return;
        if (window.speechSynthesis.speaking) window.speechSynthesis.cancel();

        const utterance = new SpeechSynthesisUtterance(textToSpeak);
        const langCode = languageCodeMap[currentTranslationLanguage.toLowerCase()];
        if (langCode) utterance.lang = langCode;
        else console.warn(`No TTS language code for: ${currentTranslationLanguage}`);

        utterance.onerror = (event) => { console.error("SpeechSynthesis Error", event); showError(`Speech error: ${event.error}`); speakButton.disabled = false;};
        utterance.onend = () => { speakButton.disabled = false; };
        utterance.onstart = () => { speakButton.disabled = true; };
        window.speechSynthesis.speak(utterance);
    }

    // --- Helper Functions ---
    function showError(message) {
        errorMessageElem.textContent = message;
        errorArea.style.display = 'block';
        hideResultAreasAndTabs(false); // Keep preview, hide results & tabs
        setLoadingState(false);
        speakButton.style.display = 'none';
        updateCorrectionButtonState(false);
    }

    function resetState() {
        stopCameraStream();
        if (imagePreview.src.startsWith('blob:')) URL.revokeObjectURL(imagePreview.src);
        if ('speechSynthesis' in window && window.speechSynthesis.speaking) window.speechSynthesis.cancel();

        currentFile = null;
        imageInput.value = '';
        imagePreview.src = '#';
        hideResultAreasAndTabs(true); // Hide all results including preview & tabs
        errorArea.style.display = 'none';
        extractedTextElem.textContent = '';
        translatedTextElem.textContent = '';
        identifiedObjectsText.textContent = '';
        correctedTextElem.textContent = '';
        ageEstimateText.textContent = '';
        loadingText.textContent = 'Processing...';
        currentTranslationLanguage = null;
        enableActionButtons(false);
        updateCorrectionButtonState(false);

        // Reset copy buttons visual state
        copyButtons.forEach(button => {
            if(button.disabled || button.classList.contains('copied-feedback')){
                 const originalIconHTML = '<i class="fa-regular fa-copy"></i> Copy';
                 button.innerHTML = originalIconHTML;
                 button.disabled = false;
                 button.classList.remove('copied-feedback');
            }
        });

         // Reset tabs to default active state (but keep hidden)
         tabButtons.forEach((button, index) => button.classList.toggle('active', index === 0));
         tabPanes.forEach((pane, index) => pane.classList.toggle('active', index === 0));
         if (tabNavigation) tabNavigation.style.display = 'none';

    }

    function capitalizeFirstLetter(string) {
        if (!string) return '';
        return string.charAt(0).toUpperCase() + string.slice(1);
    }

    // --- Initial State ---
     resetState();

}); // End DOMContentLoaded
