// Registers the alias hooks: node --import ./tests/support/register.mjs --test ...
import { register } from "node:module";

register("./alias-hooks.mjs", import.meta.url);
