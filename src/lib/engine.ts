import { ClipEngine } from './audio';

/** The one clip player for the whole page, shared by solo play and party rooms so only one clip ever plays at a time. */
export const engine = new ClipEngine();
