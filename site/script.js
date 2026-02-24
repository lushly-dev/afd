// AFD Landing Page — Intersection Observer for Scroll Animations

document.addEventListener('DOMContentLoaded', () => {
	const observerOptions = {
		root: null,
		rootMargin: '0px 0px -50px 0px',
		threshold: 0.05,
	};

	const observer = new IntersectionObserver((entries) => {
		entries.forEach((entry) => {
			if (entry.isIntersecting) {
				entry.target.classList.add('is-visible');
				observer.unobserve(entry.target);
			}
		});
	}, observerOptions);

	const animatedElements = document.querySelectorAll('.animate-up');
	animatedElements.forEach((el) => {
		// If the element is already in the viewport on load, reveal it immediately
		const rect = el.getBoundingClientRect();
		if (rect.top < window.innerHeight && rect.bottom > 0) {
			el.classList.add('is-visible');
		} else {
			observer.observe(el);
		}
	});
});
