/** The one line the development profile's child reports on stdout before it serves, or as it fails. */
export const READY = 'LOAM_DEV_READY';
export const FAILED = 'LOAM_DEV_FAILED';

/** What `ready` carries. */
export interface ChildReady {
	origin: string;
	sandboxOrigin: string | null;
	spki: string;
	certificate: string;
	mail: string;
	data: string;
}
