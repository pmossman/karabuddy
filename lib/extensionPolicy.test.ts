import { describe, expect, it } from 'vitest';
import { compareVersions, evaluateExtensionStatus } from './extensionPolicy';

describe('compareVersions', () => {
  it('orders semver-ish versions', () => {
    expect(compareVersions('0.5.0', '0.5.1')).toBe(-1);
    expect(compareVersions('0.5.1', '0.5.0')).toBe(1);
    expect(compareVersions('0.5.1', '0.5.1')).toBe(0);
    expect(compareVersions('0.6.0', '0.5.9')).toBe(1);
    expect(compareVersions('1.0.0', '0.9.9')).toBe(1);
  });
  it('tolerates short / missing parts', () => {
    expect(compareVersions('0.5', '0.5.0')).toBe(0);
    expect(compareVersions('0.5.0', '0.5')).toBe(0);
  });
});

const policy = {
  minSupportedVersion: '0.5.0',
  latestVersion: '0.6.0',
  nagMessage: 'Update available',
  blockMessage: 'Please update to keep recording',
};

describe('evaluateExtensionStatus', () => {
  it('block below minSupported', () => {
    expect(evaluateExtensionStatus('0.4.9', policy).status).toBe('block');
  });
  it('nag between minSupported and latest', () => {
    expect(evaluateExtensionStatus('0.5.0', policy).status).toBe('nag');
    expect(evaluateExtensionStatus('0.5.9', policy).status).toBe('nag');
  });
  it('ok at/above latest', () => {
    expect(evaluateExtensionStatus('0.6.0', policy).status).toBe('ok');
    expect(evaluateExtensionStatus('0.7.0', policy).status).toBe('ok');
  });
  it('unknown/blank version → ok (never brick a client we cannot identify)', () => {
    expect(evaluateExtensionStatus('', policy).status).toBe('ok');
    expect(evaluateExtensionStatus(undefined, policy).status).toBe('ok');
    expect(evaluateExtensionStatus('garbage', policy).status).toBe('ok');
  });
  it('echoes the policy versions + message for the tier', () => {
    const r = evaluateExtensionStatus('0.4.0', policy);
    expect(r.minSupportedVersion).toBe('0.5.0');
    expect(r.latestVersion).toBe('0.6.0');
    expect(r.message).toBe('Please update to keep recording');
  });
});
