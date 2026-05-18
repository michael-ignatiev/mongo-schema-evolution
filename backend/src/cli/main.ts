#!/usr/bin/env node

import { createCli } from "./createCli.js";

await createCli().parseAsync(process.argv);
