import { NIMI_PARAMETER_CONTROLS, readNimiParameterOverrides } from './request-parameters.js';

/** Keep the original ST values, with an explicit opt-in for each request field. */
export function mountNimiParameterControls(settings, save) {
    const controls = [];
    for (const descriptor of NIMI_PARAMETER_CONTROLS) {
        const input = document.getElementById(descriptor.input);
        const block = input?.closest('.range-block');
        if (!input || !block) continue;
        const label = document.createElement('label');
        label.className = 'checkbox_label';
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.id = `nimi-override-${descriptor.parameter}`;
        toggle.setAttribute('aria-label', `Send ${descriptor.label} override`);
        label.append(toggle, 'Override Nimi resource default');
        block.append(label);
        const fields = [input, ...block.querySelectorAll(`input[data-for="${descriptor.input}"]`)];
        controls.push({ descriptor, toggle, fields });
        toggle.addEventListener('change', () => {
            settings.nimi_parameter_overrides[descriptor.parameter] = toggle.checked;
            refresh();
            save();
        });
    }
    function refresh() {
        settings.nimi_parameter_overrides = readNimiParameterOverrides(settings);
        for (const { descriptor, toggle, fields } of controls) {
            toggle.checked = settings.nimi_parameter_overrides[descriptor.parameter];
            for (const field of fields) {
                field.disabled = !toggle.checked;
                field.title = toggle.checked ? 'Explicit overrides are validated by the selected Nimi resource.' : 'Using the selected Nimi resource defaults. The saved value is retained.';
            }
        }
    }
    refresh();
    return refresh;
}
