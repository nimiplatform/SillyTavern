import { synthesizeNimiSpeech } from '../../nimi/media.js';
import { getNimiClient, requireNimiCapability, captureNimiScope, assertNimiScope } from '../../nimi/platform.bundle.js';
import { splitRecursive } from '../../utils.js';
import { Popup } from '../../popup.js';
import { saveTtsProviderSettings } from './index.js';

export class NimiTtsProvider {
    separator = ' . ';
    voices = [];
    settings = { voiceMap: {}, language: '', audioFormat: 'mp3', speed: 1 };
    controller = new AbortController();
    audioElement = document.createElement('audio');
    get settingsHtml() {
        return `<p>Use this App's Nimi speech resource. Voice choices belong to that resource.</p>
            <p id="nimi-tts-status" role="status"></p>
            <label for="nimi-tts-language">Language hint</label><input id="nimi-tts-language" class="text_pole" />
            <label for="nimi-tts-speed">Speed</label><input id="nimi-tts-speed" class="text_pole" type="number" min="0.25" max="4" step="0.05" />
            <label for="nimi-tts-format">Audio format</label><select id="nimi-tts-format"><option value="mp3">MP3</option><option value="wav">WAV</option></select>
            <p>Runtime validates speed and format against the selected resource.</p>
            <button id="nimi-voice-assets" type="button" class="menu_button">Manage voice assets</button>`;
    }
    async loadSettings(settings) {
        this.settings = { ...this.settings, ...settings };
        $('#nimi-tts-language').val(this.settings.language);
        $('#nimi-tts-speed').val(this.settings.speed);
        $('#nimi-tts-format').val(this.settings.audioFormat);
        $('#nimi-tts-language, #nimi-tts-speed, #nimi-tts-format').on('change', () => {
            this.settings.language = String($('#nimi-tts-language').val());
            this.settings.speed = Number($('#nimi-tts-speed').val());
            this.settings.audioFormat = String($('#nimi-tts-format').val());
            saveTtsProviderSettings();
        });
        $('#nimi-voice-assets').on('click', () => this.manageVoiceAssets());
        try { await this.fetchTtsVoiceObjects(); } catch (error) { $('#nimi-tts-status').text(error.message); }
    }
    async checkReady() { await requireNimiCapability('audio.synthesize'); }
    async onRefreshClick() { this.voices = []; return this.fetchTtsVoiceObjects(); }
    async fetchVoiceAssets() {
        const assets = [];
        let pageToken = '';
        do {
            const page = await getNimiClient().ai.voiceAssets.list({ pageSize: 100, pageToken });
            assets.push(...page.assets); pageToken = page.nextPageToken;
        } while (pageToken);
        return assets;
    }
    async fetchTtsVoiceObjects() {
        await this.checkReady();
        const presets = await getNimiClient().aiConfig.listOptions({ kind: 'preset-voices' });
        const assets = await this.fetchVoiceAssets();
        this.voices = [
            ...presets.options.map(voice => ({ name: voice.name, voice_id: `preset:${voice.voiceId}`, lang: voice.supportedLangs[0] || '', preview_url: false })),
            ...assets.filter(asset => asset.status === 'active').map(asset => ({ name: `Voice asset ${asset.voiceAssetId}`, voice_id: `asset:${asset.voiceAssetId}`, lang: '', preview_url: false })),
        ];
        $('#nimi-tts-status').text(`${this.voices.length} voices available.`);
        return this.voices;
    }
    async getVoice(name) {
        if (!this.voices.length) await this.fetchTtsVoiceObjects();
        const voice = this.voices.find(voice => voice.name === name || voice.voice_id === name);
        if (!voice) throw new Error('This character voice is unavailable. Refresh voices and choose a current Nimi voice.');
        return voice;
    }
    async* generateTts(text, voiceId) {
        const signal = this.controller.signal;
        const scope = captureNimiScope();
        // Reuse ST's ordered chunk processing rather than keeping a whole long
        // narration in one remote request. Every completed chunk keeps its Job
        // and audio, and a failed chunk is never automatically resubmitted.
        for (const chunk of splitRecursive(text, 500)) {
            signal.throwIfAborted(); assertNimiScope(scope);
            const record = await synthesizeNimiSpeech(chunk, voiceId, this.settings, signal);
            assertNimiScope(scope);
            const asset = record.assets.find(asset => asset.mimeType.startsWith('audio/'));
            if (!asset) throw new Error('Nimi completed without a playable speech artifact.');
            const response = await fetch(asset.url, { signal });
            if (!response.ok) throw new Error('Saved Nimi speech could not be opened.');
            response.nimiMedia = record;
            yield response;
        }
    }
    async previewTtsVoice(voiceId) {
        const record = await synthesizeNimiSpeech('This is a preview of the selected voice.', voiceId, this.settings, this.controller.signal);
        const asset = record.assets.find(asset => asset.mimeType.startsWith('audio/'));
        if (!asset) throw new Error('No voice preview audio was returned.');
        this.audioElement.src = asset.url;
        await this.audioElement.play();
    }
    cancel() { this.controller.abort(); this.controller = new AbortController(); this.audioElement.pause(); }
    dispose() { this.cancel(); }
    async manageVoiceAssets() {
        const container = document.createElement('div');
        const assets = await this.fetchVoiceAssets();
        if (!assets.length) container.textContent = 'No voice assets owned by this App.';
        for (const asset of assets) {
            const row = document.createElement('div');
            const label = document.createElement('span'); label.textContent = `${asset.voiceAssetId} · ${asset.status}`;
            const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'menu_button'; remove.textContent = 'Delete';
            remove.disabled = asset.status === 'deleted';
            remove.addEventListener('click', async () => {
                if (!await Popup.show.confirm('Delete voice asset', `Delete ${asset.voiceAssetId} from Nimi? Saved audio files remain available.`)) return;
                remove.disabled = true;
                try {
                    const result = await getNimiClient().ai.voiceAssets.delete(asset.voiceAssetId);
                    if (!result.deleted) throw new Error('Nimi did not confirm deletion.');
                    label.textContent = `${asset.voiceAssetId} · deleted`;
                    this.voices = this.voices.filter(voice => voice.voice_id !== `asset:${asset.voiceAssetId}`);
                } catch (error) { remove.disabled = false; toastr.error(error.message, 'Voice deletion failed'); }
            });
            row.append(label, remove); container.append(row);
        }
        await Popup.show.text('Nimi voice assets', container);
    }
}
