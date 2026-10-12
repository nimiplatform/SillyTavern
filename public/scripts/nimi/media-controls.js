import { transcribeNimiAudio, generateNimiImage, recoverNimiMediaRecord } from './media.js';
import { captureNimiScope, assertNimiScope } from './platform.bundle.js';
import { eventSource, event_types } from '../../script.js';
import { getContext, extension_settings } from '../extensions.js';
import { Popup } from '../popup.js';
import { MEDIA_TYPE, MEDIA_SOURCE } from '../constants.js';

export function mountNimiMediaControls(container) {
    const section = document.createElement('section');
    const title = document.createElement('h4'); title.textContent = 'Audio to text';
    const file = document.createElement('input'); file.type = 'file'; file.accept = 'audio/wav,audio/mpeg'; file.id = 'nimi-transcription-file';
    const language = document.createElement('input'); language.className = 'text_pole'; language.placeholder = 'Optional language hint'; language.setAttribute('aria-label', 'Transcription language hint');
    const timingLabel = document.createElement('label');
    const timing = document.createElement('input'); timing.type = 'checkbox'; timingLabel.append(timing, ' Word times (requires alignment support)');
    const run = document.createElement('button'); run.type = 'button'; run.className = 'menu_button'; run.textContent = 'Transcribe recording';
    const output = document.createElement('div'); output.setAttribute('role', 'status');
    run.addEventListener('click', async () => {
        if (!file.files?.[0]) { output.textContent = 'Choose a WAV or MP3 recording first.'; return; }
        const scope = captureNimiScope(); run.disabled = true; output.textContent = 'Transcribing…';
        try {
            const result = await transcribeNimiAudio(file.files[0], { language: language.value, timestamps: timing.checked });
            assertNimiScope(scope);
            const transcript = result.job.transcription;
            if (!transcript) throw new Error('The completed Job has no typed transcription.');
            output.replaceChildren();
            const text = document.createElement('p'); text.textContent = transcript.status === 'no-speech' ? 'No speech detected.' : transcript.text;
            const info = document.createElement('p'); info.textContent = `Reported language: ${transcript.language || 'not reported'}. ${transcript.words.length} reported word times.`;
            output.append(text, info);
            if (transcript.status === 'transcribed') {
                const insert = document.createElement('button'); insert.type = 'button'; insert.className = 'menu_button'; insert.textContent = 'Insert into message';
                insert.addEventListener('click', () => {
                    try { assertNimiScope(scope); } catch (error) { toastr.error(error.message); return; }
                    const draft = document.getElementById('send_textarea');
                    draft.value = [draft.value, transcript.text].filter(Boolean).join('\n');
                    draft.dispatchEvent(new Event('input', { bubbles: true }));
                }); output.append(insert);
            }
        } catch (error) { output.textContent = error.message; } finally { run.disabled = false; }
    });
    section.append(title, file, language, timingLabel, run, output);
    const libraryTitle = document.createElement('h4'); libraryTitle.textContent = 'Saved media and Jobs';
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'menu_button'; refresh.textContent = 'Open saved results';
    const library = document.createElement('div');
    refresh.addEventListener('click', async () => {
        refresh.disabled = true;
        try {
            const response = await fetch('/api/nimi-media/records');
            if (!response.ok) throw new Error('Saved media could not be read.');
            const records = await response.json();
            library.replaceChildren();
            if (!records.length) library.textContent = 'No media results saved yet.';
            for (const record of records) {
                const row = document.createElement('div');
                const label = document.createElement('p'); label.textContent = `${record.scenarioType || record.job?.scenarioType} · ${record.status}`;
                row.append(label);
                if (record.error?.message) { const error = document.createElement('p'); error.textContent = record.error.message; row.append(error); }
                const resultText = record.caption || record.job?.transcription?.text;
                if (resultText) { const text = document.createElement('p'); text.textContent = resultText; row.append(text); }
                for (const asset of [...record.assets, ...(record.inputAssets || [])]) {
                    const link = document.createElement('a'); link.href = asset.url; link.download = asset.url.split('/').at(-1); link.textContent = `Save ${asset.mimeType}`; row.append(link);
                    if (asset.mimeType.startsWith('audio/')) { const audio = document.createElement('audio'); audio.src = asset.url; audio.controls = true; row.append(audio); }
                    if (asset.mimeType.startsWith('image/')) {
                        const image = document.createElement('img'); image.src = asset.url; image.alt = asset.role === 'input' ? 'Saved source image' : 'Saved generated image'; image.style.maxWidth = '100%'; row.append(image);
                        const edit = document.createElement('button'); edit.type = 'button'; edit.className = 'menu_button'; edit.textContent = 'Edit with reference image';
                        edit.addEventListener('click', async () => {
                            const prompt = await Popup.show.input('Edit image', 'Describe the change to this reference image.', '');
                            if (!prompt) return;
                            const scope = captureNimiScope(); edit.disabled = true;
                            try {
                                const result = await generateNimiImage(String(prompt), '', extension_settings.sd, undefined, asset.url);
                                assertNimiScope(scope);
                                const context = getContext();
                                const edited = result.assets.find(asset => asset.mimeType.startsWith('image/'));
                                if (!edited) throw new Error('The edit has no image result.');
                                const message = { name: context.name2, is_user: false, is_system: false, mes: String(prompt), send_date: new Date().toISOString(),
                                    extra: { media: [{ type: MEDIA_TYPE.IMAGE, source: MEDIA_SOURCE.GENERATED, url: edited.url }], nimi_media: [result] } };
                                context.chat.push(message); context.addOneMessage(message);
                                await eventSource.emit(event_types.MESSAGE_RECEIVED, context.chat.length - 1);
                                assertNimiScope(scope);
                                await context.saveChat(); await refresh.click();
                            } catch (error) { toastr.error(error.message, 'Image edit failed'); } finally { edit.disabled = false; }
                        }); row.append(edit);
                    }
                }
                if (record.purpose !== 'text-failure' && record.status !== 'completed' && (record.job?.jobId || record.issuedJobId || record.scenarioType === 'music-generate' && record.clientSubmissionId)) {
                    const recover = document.createElement('button'); recover.type = 'button'; recover.className = 'menu_button'; recover.textContent = 'Observe original Job';
                    recover.addEventListener('click', async () => {
                        recover.disabled = true;
                        try { await recoverNimiMediaRecord(record); refresh.click(); } catch (error) { toastr.error(error.message, 'Job could not be recovered'); } finally { recover.disabled = false; }
                    }); row.append(recover);
                }
                library.append(row);
            }
        } catch (error) { library.textContent = error.message; } finally { refresh.disabled = false; }
    });
    section.append(libraryTitle, refresh, library); container.append(section);
}
