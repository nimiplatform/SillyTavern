import { chat, characters, this_chid, getCurrentChatId, eventSource, event_types, setOnlineStatus, saveChatConditional, saveSettingsDebounced } from '../../script.js';
import { selected_group } from '../group-chats.js';
import { oai_settings, refreshNimiContextBudget } from '../openai.js';
import { configureScopeReader, cancelNimiWork, mountNimiConfiguration, refreshNimiConfig, getNimiSelection, getNimiModelLabel } from './platform.bundle.js';
import { resetNimiReplay, configureNimiReceiptResolver } from './history.js';
import { mountNimiMediaControls } from './media-controls.js';
import { mountNimiIntegrationTools } from './integration-tools.js';
import { mountNimiParameterControls } from './parameter-controls.js';

let initialized = false;
export function initNimiIntegration() {
    if (initialized) return;
    initialized = true;
    configureNimiReceiptResolver(id => {
        for (const message of chat) {
            if (message.extra?.nimi?.id === id) return message.extra.nimi;
            for (const swipe of message.swipe_info || []) if (swipe.extra?.nimi?.id === id) return swipe.extra.nimi;
        }
        return null;
    });
    configureScopeReader(() => JSON.stringify([selected_group, selected_group ? null : this_chid, selected_group ? null : characters[this_chid]?.avatar, getCurrentChatId()]));
    eventSource.on(event_types.CHAT_CHANGED, () => cancelNimiWork('Chat changed'));
    window.addEventListener('nimi-model-context-change', async () => { resetNimiReplay(chat); await saveChatConditional(); });
    // ST owns the editor's following save; keep this invalidation synchronous.
    eventSource.on(event_types.MESSAGE_EDITED, () => { cancelNimiWork('Message edited'); resetNimiReplay(chat); });
    eventSource.on(event_types.MESSAGE_SWIPED, () => { cancelNimiWork('Swipe selected'); resetNimiReplay(chat); });
    oai_settings.chat_completion_source = 'nimi';
    refreshNimiContextBudget();
    const refreshParameterControls = mountNimiParameterControls(oai_settings, saveSettingsDebounced);
    eventSource.on(event_types.OAI_PRESET_CHANGED_AFTER, refreshParameterControls);
    eventSource.on(event_types.SETTINGS_LOADED_AFTER, refreshParameterControls);
    // Preserve ST's request settings in its original drawer. Provider source
    // filters otherwise hide these controls when the Nimi source is selected.
    for (const id of ['openai_function_calling', 'seed_openai', 'temp_openai', 'top_p_openai', 'freq_pen_openai', 'pres_pen_openai', 'top_k_openai']) {
        const block = document.getElementById(id)?.closest('[data-source]');
        if (block) { const sources = block.dataset.source.split(','); if (!sources.includes('nimi')) sources.push('nimi'); block.dataset.source = sources.join(','); $(block).data('source', block.dataset.source).show(); }
    }
    const panel = document.getElementById('rm_api_block');
    if (panel) {
        panel.replaceChildren();
        const heading = document.createElement('h3'); heading.textContent = 'Nimi AI';
        const description = document.createElement('p'); description.textContent = 'Choose the AI resources for this App. Character prompts and generation settings remain in SillyTavern.';
        const main = document.createElement('select'); main.id = 'main_api'; main.append(new Option('Nimi chat', 'openai')); main.disabled = true;
        const source = document.createElement('select'); source.id = 'chat_completion_source'; source.append(new Option('Nimi', 'nimi')); source.disabled = true;
        const status = document.createElement('p'); status.id = 'nimi-ai-status'; status.className = 'online_status_text'; status.setAttribute('role', 'status');
        const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'menu_button'; retry.textContent = 'Refresh Nimi access';
        const config = document.createElement('div'); config.id = 'nimi-ai-config'; config.dataset.nimiScheme = 'dark'; config.dataset.nimiAccent = 'nimi-accent';
        const content = document.createElement('div'); content.className = 'scrollableInner';
        panel.append(content);
        content.append(heading, description, main, source, status, retry, config);
        mountNimiMediaControls(content);
        mountNimiIntegrationTools(content);
        async function refresh() {
            status.textContent = 'Checking Nimi access and AI configuration…';
            try {
                await refreshNimiConfig();
                const selection = getNimiSelection();
                const ready = selection?.state === 'ready';
                status.textContent = ready ? getNimiModelLabel() : selection?.reasons?.join(', ') || 'Choose a text resource below to chat.';
                setOnlineStatus(ready ? getNimiModelLabel() : 'no_connection');
            } catch (error) { status.textContent = `${error.message}. Restore access in Nimi, then refresh.`; setOnlineStatus('no_connection'); }
        }
        retry.addEventListener('click', refresh);
        mountNimiConfiguration(config, async changed => { if (changed) { resetNimiReplay(chat); await saveChatConditional(); } await refresh(); });
        window.addEventListener('focus', refresh);
        void refresh();
    }
    // Retired foundation controls stay explicit about missing equivalence.
    const unavailable = ['#request_token_probabilities', '#openai_show_thoughts', '#openai_reasoning_effort', '#openai_verbosity', '#openai_enable_web_search', '#openai_request_images', '#character_names_completion', '#continue_prefill'];
    for (const selector of unavailable) {
        const control = document.querySelector(selector);
        if (control) { control.disabled = true; control.title = 'This provider control has no admitted equivalent in this Nimi workflow.'; }
    }
}
