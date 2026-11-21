import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const VERBS = [
	"Grabbing the D",
	"LFGing",
	"Shit-posting",
	"Rage-quitting",
	"Doomscrolling",
	"Yoloing",
	"Flexing",
	"Mogging",
	"Simping",
	"Circling-back",
	"Circle-jerking",
	"Looksmaxxing",
	"Chad-posting",
	"AI-slopping",
	"Rage-baiting",
	"Entering my main character era",
	"Debugging this Ohio-level code",
	"Glazing",
	"Mewing",
	"Brainrotting",
	"Aura-farming",
	"Vibe-checking",
	"Tweaking",
	"Gaslighting",
	"Locking-in",
	"Popping-off",
	"Crashing out",
	"Geeking",
];

// Replaces pi's default "Working" loader text with a random verb on each turn.
export default function (pi: ExtensionAPI) {
	pi.on("turn_start", (_event, ctx) => {
		const verb = VERBS[Math.floor(Math.random() * VERBS.length)];
		ctx.ui.setWorkingMessage(`${verb}…`);
	});
}
