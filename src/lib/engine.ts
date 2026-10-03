import { ClipEngine } from './audio';

/** The one clip player for the whole page, shared by solo play and party rooms so only one clip ever plays at a time. */
export const engine = new ClipEngine();

// The first click or tap anywhere lets later clips play by themselves.
if (typeof window !== 'undefined') engine.unlockOnFirstGesture();
