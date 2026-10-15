export { name, inject, apply } from "./dsh.js"
export { name as pluginName, inject as pluginInject, apply as pluginApply } from "./dsh.js"
export { loadBancaTools } from "./lib/tools.js"
export { defineBancaTool } from "./lib/tool.js"

import { name, inject, apply } from "./dsh.js"

export default { apply, name, inject }
