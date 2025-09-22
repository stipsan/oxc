import { Context } from './context.js';
import { getErrorMessage } from './utils.js';

import type { AfterHook, BeforeHook, RuleMeta, Visitor, VisitorWithHooks } from './types.ts';

// Linter plugin, comprising multiple rules
export interface Plugin {
  meta: {
    name: string;
  };
  rules: {
    [key: string]: Rule;
  };
}

// Linter rule.
// `Rule` can have either `create` method, or `createOnce` method.
// If `createOnce` method is present, `create` is ignored.
export type Rule = CreateRule | CreateOnceRule;

interface CreateRule {
  meta?: RuleMeta;
  create: (context: Context) => Visitor;
}

interface CreateOnceRule {
  meta?: RuleMeta;
  create?: (context: Context) => Visitor;
  createOnce: (context: Context) => VisitorWithHooks;
}

// Linter rule and context object.
// If `rule` has a `createOnce` method, the visitor it returns is stored in `visitor`.
type RuleAndContext = CreateRuleAndContext | CreateOnceRuleAndContext;

interface CreateRuleAndContext {
  rule: CreateRule;
  context: Context;
  visitor: null;
  beforeHook: null;
  afterHook: null;
}

interface CreateOnceRuleAndContext {
  rule: CreateOnceRule;
  context: Context;
  visitor: Visitor;
  beforeHook: BeforeHook | null;
  afterHook: AfterHook | null;
}

// Absolute paths of plugins which have been loaded
const registeredPluginPaths = new Set<string>();

// Rule objects for loaded rules.
// Indexed by `ruleId`, which is passed to `lintFile`.
export const registeredRules: RuleAndContext[] = [];

// Default rule metadata, used if `rule.meta` is not supplied.
const emptyRuleMeta: RuleMeta = {
  fixable: null,
};

/**
 * Load a plugin.
 *
 * Main logic is in separate function `loadPluginImpl`, because V8 cannot optimize functions
 * containing try/catch.
 *
 * @param {string} path - Absolute path of plugin file
 * @returns {string} - JSON result
 */
export async function loadPlugin(path: string): Promise<string> {
  // TODO: Make this configurable
  const fixesEnabled = true;

  try {
    return await loadPluginImpl(path, fixesEnabled);
  } catch (err) {
    return JSON.stringify({ Failure: getErrorMessage(err) });
  }
}

async function loadPluginImpl(path: string, fixesEnabled: boolean): Promise<string> {
  if (registeredPluginPaths.has(path)) {
    return JSON.stringify({
      Failure: 'This plugin has already been registered',
    });
  }

  const { default: plugin } = (await import(path)) as { default: Plugin };

  registeredPluginPaths.add(path);

  // TODO: Use a validation library to assert the shape of the plugin, and of rules
  const pluginName = plugin.meta.name;
  const offset = registeredRules.length;
  const { rules } = plugin;
  const ruleNames = Object.keys(rules);
  const ruleNamesLen = ruleNames.length;

  for (let i = 0; i < ruleNamesLen; i++) {
    const ruleName = ruleNames[i],
      rule = rules[ruleName],
      fullRuleName = `${pluginName}/${ruleName}`;

    // Validate `rule.meta` and convert to object with standardized shape
    // (all properties defined with default values if not supplied)
    let ruleMeta = rule.meta;
    if (ruleMeta == null) {
      ruleMeta = emptyRuleMeta;
    } else {
      if (typeof ruleMeta !== 'object') throw new Error('Invalid `meta`');
      let { fixable } = ruleMeta;
      if (fixable === void 0) {
        fixable = null;
      } else if (fixable !== 'code' && fixable !== 'whitespace') {
        throw new Error('Invalid `meta.fixable`');
      }
      ruleMeta = { fixable };
    }

    const context = new Context(fullRuleName, ruleMeta, fixesEnabled);

    let ruleAndContext;
    if ('createOnce' in rule) {
      // TODO: Compile visitor object to array here, instead of repeating compilation on each file
      const { before: beforeHook, after: afterHook, ...visitor } = rule.createOnce(context);
      ruleAndContext = { rule, context, visitor, beforeHook: beforeHook || null, afterHook: afterHook || null };
    } else {
      ruleAndContext = { rule, context, visitor: null, beforeHook: null, afterHook: null };
    }

    registeredRules.push(ruleAndContext);
  }

  return JSON.stringify({ Success: { name: pluginName, offset, ruleNames } });
}
