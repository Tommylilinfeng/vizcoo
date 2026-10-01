import type { Recipe } from '../types.js'
import { splitModule } from '../../modules/split.js'

export interface SplitParams {
  moduleId: number
  count: number | null
  hint?: string
}

export const splitModuleRecipe: Recipe<SplitParams, void> = {
  name: 'split-module',
  describe: (p) => p.count !== null ? `Split into ${p.count} groups` : 'Split (let AI decide count)',
  apply: async (_parsed, p, ctx) => {
    const result = await splitModule({
      db: ctx.db,
      root: ctx.projectRoot,
      analyzers: ctx.analyzers,
      ai: ctx.ai,
      model: ctx.model,
      moduleId: p.moduleId,
      count: p.count,
      hint: p.hint,
    })
    const names = result.subModules.map((s) => s.name).join(', ')
    return {
      mutation: {
        description: `Split into ${result.subModules.length} sub-modules: ${names}`,
        affectedModuleIds: [p.moduleId, ...result.subModules.map((s) => s.id)],
      },
    }
  },
}
