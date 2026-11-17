import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import * as hegel from "@hegeldev/hegel";
import * as gs from "@hegeldev/hegel/generators";

const source = await readFile(new URL("../index.js", import.meta.url), "utf8");
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

await hegel.testAsync(async (tc) => {
	const status = tc.draw(gs.sampledFrom(["complete", "blocked"]));
	const cost = tc.draw(gs.integers({ minValue: 0, maxValue: 100 }));
	const run = await runtime();
	run.handlers.turn_start();
	await run.tools.goal_update.execute(
		"call",
		{ status, reason: "evidence" },
		undefined,
		undefined,
		run.ctx,
	);
	run.turn(cost);
	assert.equal(run.state().status, status);
	assert.equal(run.state().cost_usd, cost);
	assert.equal(run.state().run_count, 1);
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
		const old = run.messages.at(-1);
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
	for (let i = 0; i < 3; i++) {
		run.handlers.agent_start();
		run.handlers.turn_start();
		run.turn(cost);
		await run.handlers.agent_settled({ aborted: false }, run.ctx);
	}
	assert.equal(run.state().status, "blocked");
	assert.match(run.state().reason, /no new workspace/);
});
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
