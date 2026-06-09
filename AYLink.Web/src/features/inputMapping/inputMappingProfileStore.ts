import { storageKeys } from '../../core/storage/keys';
import {
  INPUT_MAPPING_SCHEMA_VERSION,
  type InputMappingProfile,
  type InputMappingProfileSummary,
  summarizeInputMappingProfile
} from './inputMappingSchema';
import { assertValidInputMappingProfile } from './inputMappingValidator';

export interface InputMappingProfileStore {
  list(): Promise<InputMappingProfileSummary[]>;
  get(id: string): Promise<InputMappingProfile | null>;
  save(profile: InputMappingProfile): Promise<void>;
  remove(id: string): Promise<void>;
  export(profile: InputMappingProfile): string;
  import(content: string): Promise<InputMappingProfile>;
}

interface StoredInputMappingProfiles {
  schemaVersion: 1;
  profiles: InputMappingProfile[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeProfile(value: unknown): InputMappingProfile {
  assertValidInputMappingProfile(value);

  return {
    schemaVersion: value.schemaVersion,
    id: value.id.trim(),
    name: value.name.trim(),
    author: typeof value.author === 'string' ? value.author.trim() : '',
    description: typeof value.description === 'string' ? value.description : '',
    target: value.target,
    bindings: value.bindings,
    createdAt: typeof value.createdAt === 'string' ? value.createdAt : undefined,
    updatedAt: typeof value.updatedAt === 'string' ? value.updatedAt : new Date().toISOString()
  };
}

function tryNormalizeProfile(value: unknown): InputMappingProfile | null {
  try {
    return normalizeProfile(value);
  } catch {
    return null;
  }
}

function readStoredProfiles(storage: Storage): StoredInputMappingProfiles {
  const raw = storage.getItem(storageKeys.inputMapping.profiles);
  if (!raw) {
    return {
      schemaVersion: INPUT_MAPPING_SCHEMA_VERSION,
      profiles: []
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw) as unknown;
  } catch {
    return {
      schemaVersion: INPUT_MAPPING_SCHEMA_VERSION,
      profiles: []
    };
  }

  if (!isRecord(parsed) || parsed.schemaVersion !== INPUT_MAPPING_SCHEMA_VERSION || !Array.isArray(parsed.profiles)) {
    return {
      schemaVersion: INPUT_MAPPING_SCHEMA_VERSION,
      profiles: []
    };
  }

  const profilesById = new Map<string, InputMappingProfile>();
  for (const profile of parsed.profiles
    .map(tryNormalizeProfile)
    .filter((profile): profile is InputMappingProfile => profile !== null)) {
    const existing = profilesById.get(profile.id);
    if (!existing || String(profile.updatedAt ?? '').localeCompare(String(existing.updatedAt ?? '')) >= 0) {
      profilesById.set(profile.id, profile);
    }
  }

  return {
    schemaVersion: INPUT_MAPPING_SCHEMA_VERSION,
    profiles: [...profilesById.values()]
  };
}

function writeStoredProfiles(storage: Storage, payload: StoredInputMappingProfiles) {
  storage.setItem(storageKeys.inputMapping.profiles, JSON.stringify(payload));
}

export function createLocalInputMappingProfileStore(storage: Storage = localStorage): InputMappingProfileStore {
  const loadProfiles = () => readStoredProfiles(storage);

  const saveProfiles = (profiles: InputMappingProfile[]) => {
    writeStoredProfiles(storage, {
      schemaVersion: INPUT_MAPPING_SCHEMA_VERSION,
      profiles
    });
  };

  return {
    async list() {
      return loadProfiles().profiles
        .map(summarizeInputMappingProfile)
        .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    },

    async get(id: string) {
      return loadProfiles().profiles.find((profile) => profile.id === id) ?? null;
    },

    async save(profile: InputMappingProfile) {
      const normalized = normalizeProfile({
        ...profile,
        updatedAt: new Date().toISOString()
      });
      const profiles = loadProfiles().profiles;
      const existingIndex = profiles.findIndex((item) => item.id === normalized.id);
      if (existingIndex >= 0) {
        profiles.splice(existingIndex, 1, normalized);
      } else {
        profiles.push(normalized);
      }
      saveProfiles(profiles);
    },

    async remove(id: string) {
      saveProfiles(loadProfiles().profiles.filter((profile) => profile.id !== id));
    },

    export(profile: InputMappingProfile) {
      return `${JSON.stringify(normalizeProfile(profile), null, 2)}\n`;
    },

    async import(content: string) {
      const parsed = JSON.parse(content) as unknown;
      return normalizeProfile(parsed);
    }
  };
}
