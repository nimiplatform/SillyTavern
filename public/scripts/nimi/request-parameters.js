export const NIMI_PARAMETER_CONTROLS = [
    { parameter: 'temperature', setting: 'temp_openai', input: 'temp_openai', label: 'Temperature' },
    { parameter: 'top_p', setting: 'top_p_openai', input: 'top_p_openai', label: 'Top P' },
    { parameter: 'max_tokens', setting: 'openai_max_tokens', input: 'openai_max_tokens', label: 'Response length' },
    { parameter: 'presence_penalty', setting: 'pres_pen_openai', input: 'pres_pen_openai', label: 'Presence penalty' },
    { parameter: 'frequency_penalty', setting: 'freq_pen_openai', input: 'freq_pen_openai', label: 'Frequency penalty' },
    { parameter: 'top_k', setting: 'top_k_openai', input: 'top_k_openai', label: 'Top K' },
    { parameter: 'seed', setting: 'seed', input: 'seed_openai', label: 'Seed' },
];

/** An old saved value is preserved; a new settings/preset explicitly declares unset. */
export function readNimiParameterOverrides(settings, { preset = false } = {}) {
    const declared = settings.nimi_parameter_overrides;
    if (declared !== undefined && (!declared || typeof declared !== 'object' || Array.isArray(declared))) {
        throw new Error('Nimi generation overrides must be a settings object.');
    }
    return Object.fromEntries(NIMI_PARAMETER_CONTROLS.map(({ parameter, setting }) => {
        if (declared !== undefined) {
            const enabled = declared[parameter];
            if (enabled !== undefined && typeof enabled !== 'boolean') throw new Error(`Invalid override state for ${parameter}.`);
            return [parameter, enabled === true];
        }
        const key = preset ? parameter : setting;
        const value = settings[key];
        const enabled = Object.hasOwn(settings, key) && value !== undefined && value !== null && value !== ''
            && !(parameter === 'seed' && Number(value) < 0) && !(parameter === 'top_k' && Number(value) === 0);
        return [parameter, enabled];
    }));
}

/** Only declared overrides enter inference; retained slider values are not defaults. */
export function nimiRequestParameters(settings) {
    const enabled = readNimiParameterOverrides(settings);
    const result = {};
    for (const { parameter, setting, label } of NIMI_PARAMETER_CONTROLS) {
        if (!enabled[parameter]) continue;
        const value = settings[setting];
        if (value === null || value === undefined || typeof value === 'boolean' || String(value).trim() === '' || !Number.isFinite(Number(value))) {
            throw new Error(`Set a numeric ${label} override or use the Nimi resource default.`);
        }
        result[parameter] = Number(value);
    }
    return result;
}
