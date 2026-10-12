import { ToolManager } from '../tool-calling.js';
import { getNimiClient, beginNimiOperation } from './platform.bundle.js';
import { extension_settings } from '../extensions.js';
import { saveSettingsDebounced } from '../../script.js';
import { invokeIntegrationCall } from './integration-call.js';
export function mountNimiIntegrationTools(container) {
    const selected = new Set(extension_settings.nimi_tool_operations || []);
    const registered = new Set();
    const title = document.createElement('h4'); title.textContent = 'Nimi tool services';
    const help = document.createElement('p'); help.textContent = 'Choose operations already permitted to this App in Nimi. SillyTavern executes callbacks and decides subsequent model turns.';
    const refresh = document.createElement('button'); refresh.type = 'button'; refresh.className = 'menu_button'; refresh.textContent = 'Read available tool services';
    const list = document.createElement('div'); list.setAttribute('role', 'status');
    refresh.addEventListener('click', async () => {
        refresh.disabled = true;
        for (const name of registered) ToolManager.unregisterFunctionTool(name);
        registered.clear();
        list.replaceChildren();
        list.textContent = 'Reading permitted operations…';
        try {
            const targets = await getNimiClient().integration.listConnections();
            list.replaceChildren();
            if (!targets.length) list.textContent = 'No configured Nimi tool services are available.';
            for (const target of targets) for (const operation of target.operations) {
                const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([target.targetRef, operation.name])));
                const hash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('').slice(0, 32);
                const name = `nimi_${hash}`;
                const label = document.createElement('label'); const enable = document.createElement('input'); enable.type = 'checkbox';
                enable.disabled = !target.available || !target.permittedOperations.includes(operation.name);
                if (enable.disabled) selected.delete(name);
                enable.checked = selected.has(name);
                label.append(enable, `${target.displayName} · ${operation.name} (${operation.effect})`);
                const update = () => {
                    if (!enable.checked) { selected.delete(name); registered.delete(name); ToolManager.unregisterFunctionTool(name); return; }
                    try {
                        ToolManager.registerFunctionTool({ name, displayName: `${target.displayName}: ${operation.name}`, description: operation.description,
                            parameters: JSON.parse(operation.inputSchemaJson), action: (input, context) => invokeIntegrationCall(
                                getNimiClient().integration, { targetRef: target.targetRef, operation: operation.name, inputJson: JSON.stringify(input) },
                                beginNimiOperation(), context?.onIssued,
                            ),
                            shouldRegister: () => enable.checked && target.available, stealth: false });
                        selected.add(name); registered.add(name);
                    } catch (error) { enable.checked = false; toastr.error(error.message, 'Tool could not be enabled'); }
                };
                enable.addEventListener('change', () => {
                    update();
                    extension_settings.nimi_tool_operations = [...selected];
                    saveSettingsDebounced();
                });
                if (enable.checked) update();
                list.append(label);
            }
        } catch (error) { list.textContent = error.message; } finally { refresh.disabled = false; }
    });
    container.append(title, help, refresh, list);
    if (selected.size) refresh.click();
}
