import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

const source = (await readFile(new URL("../index.js", import.meta.url), "utf8"))
	.replace(
		'import { Box, Text } from "@earendil-works/pi-tui";',
		"class Text { constructor(text) { this.text = text; } } class Box { addChild() {} }",
	)
	.replace(
		'import * as review_sdk from "@earendil-works/pi-coding-agent";',
		"const review_sdk = globalThis.goal_review_sdk;",
	);
const review = {
	status: "complete",
	reason: "All requirements inspected.",
	cost: 0,
	inspect: true,
	hook: null,
	disposed: 0,
	options: null,
	prompt: null,
};
globalThis.goal_review_sdk = {
	createExtensionRuntime: () => ({}),
	SessionManager: { inMemory: () => ({}) },
	SettingsManager: { inMemory: (settings) => settings },
	createAgentSession: async (options) => {
		review.options = options;
		let listener;
		return {
			session: {
				subscribe: (callback) => {
					listener = callback;
					return () => {};
				},
				prompt: async (prompt) => {
					review.prompt = JSON.parse(prompt);
					if (review.hook) await review.hook();
					if (review.inspect)
						listener({
							type: "tool_execution_end",
							toolName: "read",
							isError: false,
						});
					listener({
						type: "message_end",
						message: {
							role: "assistant",
							usage: { cost: { total: review.cost } },
						},
					});
				},
				getLastAssistantText: () =>
					JSON.stringify({ status: review.status, reason: review.reason }),
				abort: async () => {},
				dispose: () => {
					review.disposed++;
				},
			},
		};
	},
};
let instance_count = 0;

async function runtime(args = "objective") {
	const { default: load } = await import(
		`data:text/javascript;base64,${Buffer.from(`${source}\n// instance ${instance_count++}`).toString("base64")}`
	);
	const handlers = {},
		commands = {},
		tools = {};
	const messages = [];
	let state = null;
	let abort_count = 0;
	let active_tools = [];
	const pi = {
		registerMessageRenderer() {},
		registerCommand: (name, command) => {
			commands[name] = command;
		},
		registerTool: (tool) => {
			tools[tool.name] = tool;
		},
		on: (name, handler) => {
			handlers[name] = handler;
		},
		exec: async () => ({ code: 1 }),
		appendEntry: (_type, data) => {
			state = structuredClone(data.goal);
		},
		getActiveTools: () => active_tools,
		setActiveTools: (names) => {
			active_tools = names;
		},
		sendMessage: (message) => {
			messages.push({ role: "custom", ...message });
		},
	};
	const ctx = {
		cwd: process.cwd(),
		model: { id: "test-model" },
		ui: { notify() {}, setStatus() {}, confirm: async () => true },
		isIdle: () => true,
		hasPendingMessages: () => false,
		abort: () => {
			abort_count++;
		},
	};
	load(pi);
	const command = (text) => commands.goal.handler(text, ctx);
	const turn = (cost) =>
		handlers.turn_end(
			{
				message: {
					role: "assistant",
					usage: { cost: { total: cost } },
					content: [{ type: "toolCall" }],
				},
				toolResults: [],
			},
			ctx,
		);
	await command(args);
	return {
		handlers,
		tools,
		ctx,
		command,
		turn,
		messages,
		state: () => state,
		abort_count: () => abort_count,
	};
}

await hegel.testAsync(async (tc) => {
	const limit = tc.draw(gs.integers({ minValue: 1, maxValue: 20 }));
	const cost_limit = tc.draw(gs.integers({ minValue: 1, maxValue: 20 }));
	const cost = tc.draw(gs.integers({ minValue: 1, maxValue: 10 }));
	const run = await runtime(`--turns ${limit} --cost ${cost_limit} objective`);
	run.handlers.agent_start();
	let count = 0;
	while (run.state().status === "active" && count < 20) {
		run.handlers.turn_start();
		run.turn(cost);
		count++;
	}
	assert.equal(count, Math.min(limit, Math.ceil(cost_limit / cost)));
	assert.equal(run.state().cost_usd, count * cost);
	assert.equal(run.abort_count(), 1);
	const sent = run.messages.length;
	await run.command("resume");
	assert.equal(run.state().status, "paused");
	assert.equal(run.messages.length, sent);

	run.ctx.hasUI = true;
	const original = run.state();
	run.ctx.ui.input = async () => "2";
	run.ctx.ui.confirm = async () => false;
	await run.command("resume");
	assert.deepEqual(run.state(), original);
	assert.equal(run.messages.length, sent);
	run.ctx.ui.confirm = async () => true;
	await run.command("resume");
	const updated = run.state();
	assert.equal(updated.status, "active");
	assert.equal(updated.run_count, count);
	assert.equal(updated.cost_usd, count * cost);
	assert.equal(updated.run_count_max, count >= limit ? count + 2 : limit);
	assert.equal(
		updated.cost_usd_max,
		count * cost >= cost_limit ? count * cost + 2 : cost_limit,
	);
});

{
	const run = await runtime("--turns 4 --cost 5 original objective");
	const old_token = run.messages
		.at(-1)
		.content.match(/Completion token: ([a-f0-9]+)/)[1];
	await run.command("revise rejected while active");
	assert.equal(run.state().objective, "original objective");
	run.handlers.agent_start();
	run.handlers.turn_start();
	run.turn(1);
	await run.command("pause");
	const original = run.state();
	const sent = run.messages.length;
	await run.command("revise");
	assert.deepEqual(run.state(), original);
	await run.command("revise revised objective");
	assert.deepEqual(run.state(), {
		...original,
		objective: "revised objective",
		reason: "objective revised",
		revision: original.revision + 1,
	});
	assert.equal(run.messages.length, sent + 1);
	await run.command("resume");
	assert.match(run.messages.at(-1).content, /revised objective/);
	const current = run.state();
	const result = await run.tools.goal_update.execute(
		"stale",
		{ token: old_token, status: "complete", reason: "old evidence" },
		undefined,
		undefined,
		run.ctx,
	);
	assert.equal(result.isError, true);
	assert.deepEqual(run.state(), current);
}

{
	const run = await runtime("--turns 1 --cost 1 objective");
	run.handlers.agent_start();
	run.handlers.turn_start();
	run.turn(2);
	const original = run.state();
	await run.command("resume --add-turns 3");
	assert.deepEqual(run.state(), original);
	await run.command("resume --add-cost 1.50 --add-turns 3");
	assert.equal(run.state().status, "active");
	assert.equal(run.state().run_count_max, 4);
	assert.equal(run.state().cost_usd_max, 3.5);
}

await hegel.testAsync(async (tc) => {
	const status = tc.draw(gs.sampledFrom(["complete", "blocked"]));
	const cost = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
	const run = await runtime();
	run.handlers.turn_start();
	await run.tools.goal_update.execute(
		"call",
		{
			status,
			reason: "evidence",
			token: run.messages
				.at(-1)
				.content.match(/Completion token: ([a-f0-9]+)/)[1],
		},
		undefined,
		undefined,
		run.ctx,
	);
	run.turn(cost);
	assert.equal(run.state().status, status);
	assert.equal(run.state().cost_usd, cost);
	assert.equal(run.state().run_count, status === "complete" ? 2 : 1);
});

await hegel.testAsync(async (tc) => {
	const commands = tc.draw(
		gs.arrays(gs.sampledFrom(["pause", "clear", "replacement", "resume"]), {
			minSize: 1,
			maxSize: 12,
		}),
	);
	const run = await runtime();
	for (const command of commands) {
		const old = run.messages.findLast((message) => message.details?.goal_id);
		await run.command(command);
		const current = run.state();
		const valid =
			current?.status === "active" &&
			old.details.goal_id === current.id &&
			old.details.revision === current.revision;
		const result = run.handlers.context({ messages: [old] });
		assert.equal(result === undefined, valid);
		if (!valid) assert.deepEqual(result.messages, []);
	}
});

await hegel.testAsync(async (tc) => {
	const cost = tc.draw(gs.integers({ minValue: 0, maxValue: 10 }));
	const run = await runtime();
	for (let i = 0; i < 4; i++) {
		run.handlers.agent_start();
		run.handlers.turn_start();
		run.turn(cost);
		await run.handlers.agent_settled({ aborted: false }, run.ctx);
		if (i === 2) {
			assert.equal(run.state().status, "active");
			assert.match(run.messages.at(-1).content, /Try a different diagnostic/);
		}
	}
	assert.equal(run.state().status, "blocked");
	assert.match(run.state().reason, /no new workspace/);
});
await hegel.testAsync(async (tc) => {
	const verdict = tc.draw(
		gs.sampledFrom(["complete", "incomplete", "blocked", "invalid"]),
	);
	const inspected = tc.draw(gs.booleans());
	const cost = tc.draw(gs.integers({ minValue: 0, maxValue: 10 }));
	const operation = tc.draw(gs.sampledFrom(["none", "pause", "clear"]));
	const run = await runtime("build the full TUI end-to-end");
	const token = run.messages
		.at(-1)
		.content.match(/Completion token: ([a-f0-9]+)/)[1];
	Object.assign(review, {
		status: verdict,
		reason: "Missing TUI; backend slice is not the full objective.",
		cost,
		inspect: inspected,
		hook: operation === "none" ? null : () => run.command(operation),
	});
	const disposed = review.disposed;
	const result = await run.tools.goal_update.execute(
		"review",
		{
			token,
			status: "complete",
			reason: "Backend cache implemented; tests pass.",
		},
		undefined,
		undefined,
		run.ctx,
	);
	assert.equal(review.disposed, disposed + 1);
	assert.deepEqual(review.options.tools, ["read", "grep", "find", "ls"]);
	assert.equal(review.prompt.objective, "build the full TUI end-to-end");
	assert.match(
		review.options.resourceLoader.getSystemPrompt(),
		/not a finished TUI/,
	);
	if (operation === "clear") assert.equal(run.state(), null);
	else {
		assert.equal(run.state().cost_usd, cost);
		assert.equal(run.state().run_count, 1);
		const expected =
			operation === "pause"
				? "paused"
				: !inspected || verdict === "invalid" || verdict === "blocked"
					? "blocked"
					: verdict === "incomplete"
						? "active"
						: "complete";
		assert.equal(run.state().status, expected);
		assert.equal(result.isError === true, expected !== "complete");
		if (expected === "active")
			assert.match(result.content[0].text, /Missing TUI/);
	}
});
Object.assign(review, {
	status: "complete",
	reason: "All requirements inspected.",
	cost: 0,
	inspect: true,
	hook: null,
});
await hegel.testAsync(async (tc) => {
	const allowance = tc.draw(gs.integers({ minValue: 1, maxValue: 10 }));
	const kind = tc.draw(gs.sampledFrom(["cost", "turns"]));
	const run = await runtime(`--${kind} ${allowance} full objective`);
	const token = run.messages
		.at(-1)
		.content.match(/Completion token: ([a-f0-9]+)/)[1];
	Object.assign(review, { cost: kind === "cost" ? allowance : 0, hook: null });
	if (kind === "turns") {
		for (let i = 1; i < allowance; i++) {
			run.handlers.turn_start();
			run.turn(0);
		}
	}
	await run.tools.goal_update.execute(
		"budget-review",
		{ token, status: "complete", reason: "claimed evidence" },
		undefined,
		undefined,
		run.ctx,
	);
	assert.equal(run.state().status, "paused");
	assert.match(run.state().reason, /limit reached/);
});
review.cost = 0;
console.log("Hegel lifecycle properties passed");

// Exercise the installed Pi loader without starting a provider request.
await new Promise((resolve, reject) => {
	const child = spawn(
		"pi",
		["--no-extensions", "--no-session", "-e", "./index.js", "--mode", "rpc"],
		{ cwd: new URL("..", import.meta.url), stdio: ["pipe", "pipe", "pipe"] },
	);
	let output = "",
		errors = "",
		settled = false;
	const timeout = setTimeout(
		() => finish(new Error(`Pi smoke check timed out: ${errors}`)),
		15000,
	);
	function finish(error) {
		if (settled) return;
		settled = true;
		clearTimeout(timeout);
		child.kill();
		if (error) reject(error);
		else resolve();
	}
	child.on("error", finish);
	child.stdin.on("error", finish);
	child.stderr.on("data", (data) => {
		errors = (errors + data).slice(-16000);
	});
	child.stdout.on("data", (data) => {
		output += data;
		if (output.length > 1000000)
			return finish(new Error("Pi smoke output exceeded limit"));
		const lines = output.split("\n");
		output = lines.pop();
		for (const line of lines) {
			let message;
			try {
				message = JSON.parse(line);
			} catch {
				continue;
			}
			if (message.id !== "goal-smoke") continue;
			try {
				assert.equal(message.success, true, JSON.stringify(message));
				assert.ok(
					message.data.commands.some((command) => command.name === "goal"),
					"goal command was not loaded",
				);
				finish();
			} catch (error) {
				finish(error);
			}
		}
	});
	child.on("exit", (code) => {
		if (!settled) finish(new Error(`Pi exited (${code}): ${errors}`));
	});
	child.stdin.write(
		`${JSON.stringify({ id: "goal-smoke", type: "get_commands" })}\n`,
	);
});
console.log("Pi extension load smoke check passed");
