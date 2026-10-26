export const pinnedConvexVersion = '1.32.0';

export function assertPinnedConvexFixtureDependency(packageJson) {
	if (packageJson?.dependencies?.convex !== pinnedConvexVersion) {
		throw new Error('Convex fixture package.json must pin convex 1.32.0 in dependencies');
	}
	return packageJson;
}
