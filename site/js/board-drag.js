// Drag a card between the board's three priority lanes. Pointer events, so it
// works with a mouse, a pen or a finger. Keyboard users change priority with
// the card's priority button instead.

const LANES = ['high', 'medium', 'low'];

/**
 * @param {object} options
 * @param {HTMLElement} options.list The task list; lanes are its three equal columns.
 * @param {() => boolean} options.isBoard Whether the board is the surface on show.
 * @param {(id: string, priority: string) => void} options.onDrop
 */
export function initBoardDrag({ list, isBoard, onDrop }) {
	list.addEventListener('pointerdown', (event) => {
		if (!isBoard() || event.button !== 0) return;
		const card = event.target.closest('.task');
		if (!card || event.target.closest('button, input, a')) return;

		const origin = { x: event.clientX, y: event.clientY };
		const box = card.getBoundingClientRect();
		let ghost = null;

		const move = (moved) => {
			if (!ghost) {
				// A small dead zone, so a click is still a click.
				if (Math.hypot(moved.clientX - origin.x, moved.clientY - origin.y) < 5) return;
				ghost = card.cloneNode(true);
				ghost.classList.add('task-ghost');
				ghost.removeAttribute('data-task-id');
				ghost.setAttribute('aria-hidden', 'true');
				ghost.style.width = `${box.width}px`;
				ghost.style.left = `${box.left}px`;
				ghost.style.top = `${box.top}px`;
				list.append(ghost);
				card.classList.add('is-dragging');
			}
			ghost.style.transform = `translate(${moved.clientX - origin.x}px, ${moved.clientY - origin.y}px)`;
			const lanes = list.getBoundingClientRect();
			const index = Math.floor(((moved.clientX - lanes.left) / lanes.width) * LANES.length);
			list.dataset.drop = LANES[Math.min(LANES.length - 1, Math.max(0, index))];
		};
		const finish = (dropped) => {
			removeEventListener('pointermove', move);
			removeEventListener('pointerup', finish);
			removeEventListener('pointercancel', finish);
			if (!ghost) return;
			const lane = list.dataset.drop;
			delete list.dataset.drop;
			ghost.remove();
			card.classList.remove('is-dragging');
			if (dropped.type === 'pointerup' && lane && lane !== card.dataset.priority) {
				onDrop(card.dataset.taskId, lane);
			}
		};
		addEventListener('pointermove', move);
		addEventListener('pointerup', finish);
		addEventListener('pointercancel', finish);
	});
}
