#!/usr/bin/env node
import { main } from '../../../scripts/check-outline-contract.js'

export { verify, FIELDS, SUBSECTIONS, FIVE_ACT } from '../../../scripts/check-outline-contract.js'

if (import.meta.main) process.exitCode = main(process.argv.slice(2))
