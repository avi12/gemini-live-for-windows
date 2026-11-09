import { runMock } from "./mock.ts";
import { runWatchApp } from "./watch-app.ts";

const MOCK_ARGUMENT = "--mock";

const IS_MOCK = process.argv.includes(MOCK_ARGUMENT);

process.exit(await (IS_MOCK ? runMock() : runWatchApp()));
