import type { Recipe } from './types.js'
import { agentRecipe } from './recipes/agent.js'
import { askModuleRecipe } from './recipes/ask-module.js'
import { askRelationRecipe } from './recipes/ask-relation.js'
import { splitModuleRecipe } from './recipes/split-module.js'

const recipes = new Map<string, Recipe<unknown, unknown>>()
recipes.set(agentRecipe.name, agentRecipe as Recipe<unknown, unknown>)
recipes.set(askModuleRecipe.name, askModuleRecipe as Recipe<unknown, unknown>)
recipes.set(askRelationRecipe.name, askRelationRecipe as Recipe<unknown, unknown>)
recipes.set(splitModuleRecipe.name, splitModuleRecipe as Recipe<unknown, unknown>)

export function findRecipe(name: string): Recipe<unknown, unknown> | undefined {
  return recipes.get(name)
}

export function listRecipes(): string[] {
  return [...recipes.keys()]
}
