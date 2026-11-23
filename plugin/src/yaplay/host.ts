// Yapin's store is internal. Discover loaded exports by shape, never by bundle IDs.
export interface Voice { channelId: string; serverId?: string; muted: boolean; deafened: boolean }
export interface Member { userId: string; muted: boolean; deafened: boolean }
export interface HostState {
  userId: string | null;
  voice: Voice | null;
  voiceMembers: Record<string, Member[]>;
  speaking: Record<string, boolean>;
  profiles: Record<string, { display_name?: string; username?: string; accent_color?: string; avatar_path?: string | null }>;
  serverLooks?: Record<string, Record<string, { avatar_path?: string | null }>>;
}
export interface HostStore {
  getState(): HostState;
  useStore: { subscribe(callback: () => void): () => void };
  displayName?(state: HostState, server: string | undefined, user: string): string;
  nameColor?(state: HostState, server: string | undefined, user: string): string | undefined;
}
interface Runtime { c: Map<unknown, { exports?: Record<string, unknown> }> }
interface ChunkQueue { push(chunk: unknown[]): unknown }
let runtimePromise: Promise<Runtime> | undefined;

export function getRuntime(): Promise<Runtime> {
  if (runtimePromise) return runtimePromise;
  const queue = (window as unknown as { TURBOPACK?: ChunkQueue }).TURBOPACK;
  if (!queue || Array.isArray(queue)) return Promise.reject(new Error('Yapin is still loading.'));
  runtimePromise = new Promise<Runtime>((resolve, reject) => {
    const id = `yapmod-yaplay-${crypto.randomUUID()}`;
    const timeout = setTimeout(() => reject(new Error('Yapin module discovery timed out.')), 3000);
    queue.push([id, id, (runtime: Runtime) => { clearTimeout(timeout); resolve(runtime); }]);
    Promise.resolve(queue.push([id, { otherChunks: [], runtimeModuleIds: [id] }])).catch(reject);
  }).catch(error => { runtimePromise = undefined; throw error; });
  return runtimePromise;
}

export function findStore(runtime: Runtime): HostStore | undefined {
  for (const module of runtime.c.values()) {
    const value = module.exports as unknown as HostStore | undefined;
    if (typeof value?.getState !== 'function' || typeof value.useStore?.subscribe !== 'function') continue;
    const state = value.getState();
    if (state && 'voice' in state && state.voiceMembers && state.speaking && state.profiles) return value;
  }
}

export interface Snapshot {
  in_call: boolean;
  members: { id: string; name: string; avatar_url?: string; color: [number, number, number]; speaking: boolean; muted: boolean; is_self: boolean }[];
  muted: boolean;
  deafened: boolean;
}
type PublicUrl = (bucket: string, path: string) => unknown;
function avatarUrl(resolve: PublicUrl | undefined, path: string | null | undefined): string | undefined {
  if (!path || !resolve) return;
  try {
    const resolved = resolve('avatars', path);
    if (typeof resolved !== 'string' || !resolved) return;
    const url = new URL(resolved, 'https://www.yapin.gg');
    if (url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 2048) return url.href;
  } catch { /* Missing or invalid images use Yaplay's initials fallback. */ }
}

export function snapshot(store: HostStore, runtime?: Runtime): Snapshot {
  const state = store.getState();
  const voice = state.voice;
  if (!voice) return { in_call: false, members: [], muted: false, deafened: false };
  const media = runtime && [...runtime.c.values()].map(module => module.exports)
    .find(value => typeof value?.publicUrl === 'function');
  const resolveAvatar = media?.publicUrl as PublicUrl | undefined;
  const members = [...(state.voiceMembers[voice.channelId] ?? [])];
  if (state.userId && !members.some(member => member.userId === state.userId)) {
    members.push({ userId: state.userId, muted: voice.muted, deafened: voice.deafened });
  }
  return {
    in_call: true, muted: voice.muted || voice.deafened, deafened: voice.deafened,
    members: members.map(member => {
      const self = member.userId === state.userId;
      const profile = state.profiles[member.userId];
      const avatar = avatarUrl(resolveAvatar, (voice.serverId && state.serverLooks?.[voice.serverId]?.[member.userId]?.avatar_path) || profile?.avatar_path);
      const hex = store.nameColor?.(state, voice.serverId, member.userId) ?? profile?.accent_color ?? '';
      const color: [number, number, number] = /^#[\da-f]{6}$/i.test(hex)
        ? [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)] : [103, 80, 164];
      const muted = self ? voice.muted || voice.deafened : member.muted || member.deafened;
      return { id: member.userId, name: (store.displayName?.(state, voice.serverId, member.userId)
        ?? profile?.display_name ?? profile?.username ?? 'Someone').slice(0, 128), ...(avatar ? { avatar_url: avatar } : {}), color,
      speaking: Boolean(state.speaking[member.userId]) && !muted, muted, is_self: self };
    }),
  };
}

export type Action = { type: 'set_mute'; muted: boolean } | { type: 'set_deafen'; deafened: boolean } | { type: 'leave_call' };
const voiceMethods = {
  set_mute: 'toggleMute',
  set_deafen: 'toggleDeafen',
  leave_call: 'leaveVoice',
} as const;

function findMethod(runtime: Runtime, method: string) {
  for (const { exports } of runtime.c.values()) {
    if (typeof exports?.[method] === 'function') return exports;
  }
}

export function availableActions(runtime: Runtime) {
  return (Object.keys(voiceMethods) as Action['type'][]).filter(action => findMethod(runtime, voiceMethods[action]));
}

export async function perform(runtime: Runtime, store: HostStore, action: Action) {
  const voice = store.getState().voice;
  if (!voice) return;
  switch (action.type) {
    case 'set_mute':
      if (typeof action.muted !== 'boolean' || voice.muted === action.muted) return;
      break;
    case 'set_deafen':
      if (typeof action.deafened !== 'boolean' || voice.deafened === action.deafened) return;
      break;
    case 'leave_call': break;
    default: return;
  }
  const method = voiceMethods[action.type];
  const api = findMethod(runtime, method);
  if (!api) throw new Error('Yapin voice control is unavailable.');
  await (api[method] as () => unknown)();
}
