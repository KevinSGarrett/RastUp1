export function createVariableResolver({
  baseVariables = {},
  templateOverrides = {},
  compute = {},
  signerOverrides = {}
} = {}) {
  function resolveBaseVariables({ template, context }) {
    const defaults = template.defaultVariables ?? {};
    const base = typeof baseVariables === 'function' ? baseVariables({ template, context }) : baseVariables;
    const contextVariables = context?.variables ?? {};
    const overrides =
      typeof templateOverrides === 'function'
        ? templateOverrides({ template, context })
        : templateOverrides?.[template.templateId] ?? {};
    return {
      ...(typeof defaults === 'object' && !Array.isArray(defaults) ? defaults : {}),
      ...(typeof base === 'object' && !Array.isArray(base) ? base : {}),
      ...(typeof contextVariables === 'object' && !Array.isArray(contextVariables) ? contextVariables : {}),
      ...(typeof overrides === 'object' && !Array.isArray(overrides) ? overrides : {})
    };
  }

  function runComputeHook({ template, context, variables }) {
    const hook =
      typeof compute === 'function'
        ? compute({ template, context, variables })
        : compute?.[template.templateId];
    if (typeof hook !== 'function') {
      return { variables, missing: [], invalid: [] };
    }
    const result = hook({ template, context, variables }) ?? {};
    if (result.variables && typeof result.variables === 'object') {
      Object.assign(variables, result.variables);
    }
    return {
      variables,
      missing: Array.isArray(result.missing) ? result.missing : [],
      invalid: Array.isArray(result.invalid) ? result.invalid : []
    };
  }

  function resolveSignerOverrides({ template, context }) {
    const base =
      typeof signerOverrides === 'function'
        ? signerOverrides({ template, context })
        : signerOverrides ?? {};
    const templateSpecific = base?.[template.templateId] ?? {};
    const merged = { ...(base?.default ?? {}), ...templateSpecific };

    for (const role of template.signerRoles ?? []) {
      if (merged[role.role]) {
        continue;
      }
      const roleKey = role.role.toLowerCase();
      if (roleKey === 'buyer') {
        merged[role.role] =
          context?.signerOverrides?.buyer ??
          context?.variables?.buyerEmail ??
          context?.variables?.buyer_email ??
          null;
      } else if (roleKey === 'seller' || roleKey === 'talent') {
        merged[role.role] =
          context?.signerOverrides?.seller ??
          context?.variables?.sellerEmail ??
          context?.variables?.seller_email ??
          null;
      } else if (roleKey === 'studio_owner' || roleKey === 'studio') {
        merged[role.role] =
          context?.signerOverrides?.studio ??
          context?.variables?.studioOwnerEmail ??
          context?.variables?.studio_owner_email ??
          null;
      }
    }

    return merged;
  }

  return {
    resolveVariables({ template, context }) {
      const base = resolveBaseVariables({ template, context });
      return runComputeHook({ template, context, variables: base });
    },
    resolveSignerMap({ template, context }) {
      return resolveSignerOverrides({ template, context });
    }
  };
}
