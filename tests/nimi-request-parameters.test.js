import fs from 'node:fs';
import { nimiRequestParameters, readNimiParameterOverrides } from '../public/scripts/nimi/request-parameters.js';

test('fresh defaults retain slider values without imposing inference overrides', () => {
    const settings = JSON.parse(fs.readFileSync(new URL('../default/content/settings.json', import.meta.url))).oai_settings;
    expect(settings.temp_openai).toBe(1);
    expect(settings.openai_max_tokens).toBe(300);
    expect(nimiRequestParameters(settings)).toEqual({});
    const preset = JSON.parse(fs.readFileSync(new URL('../default/content/presets/openai/Default.json', import.meta.url)));
    expect(Object.values(readNimiParameterOverrides(preset, { preset: true })).every(value => value === false)).toBe(true);
});

test('existing saved settings preserve explicit values even when equal to old defaults', () => {
    expect(nimiRequestParameters({ temp_openai: 1, top_p_openai: 1, openai_max_tokens: 300, pres_pen_openai: 0, freq_pen_openai: 0, top_k_openai: 0, seed: -1 })).toEqual({
        temperature: 1, top_p: 1, max_tokens: 300, presence_penalty: 0, frequency_penalty: 0,
    });
    expect(readNimiParameterOverrides({ temperature: 1, max_tokens: 300 }, { preset: true })).toMatchObject({ temperature: true, max_tokens: true });
});

test('unsetting an override retains its value and persists across settings round trips', () => {
    const settings = { temp_openai: 0.2, nimi_parameter_overrides: { temperature: true } };
    expect(nimiRequestParameters(settings)).toEqual({ temperature: 0.2 });
    settings.nimi_parameter_overrides.temperature = false;
    expect(nimiRequestParameters(JSON.parse(JSON.stringify(settings)))).toEqual({});
    expect(settings.temp_openai).toBe(0.2);
    settings.nimi_parameter_overrides.temperature = true;
    expect(nimiRequestParameters(settings)).toEqual({ temperature: 0.2 });
});

test('explicit unsupported values are carried to owner validation instead of silently removed', () => {
    expect(nimiRequestParameters({ seed: -1, top_k_openai: 0, nimi_parameter_overrides: { seed: true, top_k: true } })).toEqual({ seed: -1, top_k: 0 });
    expect(() => nimiRequestParameters({ temp_openai: '', nimi_parameter_overrides: { temperature: true } })).toThrow('Set a numeric Temperature override');
    expect(() => readNimiParameterOverrides({ nimi_parameter_overrides: { temperature: 'false' } })).toThrow('Invalid override state');
});
