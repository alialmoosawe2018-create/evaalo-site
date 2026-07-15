/** Feature flag: enable dynamic form renderer for non-pub legacy URLs (Phase 3). */
export function isDynamicFormEnabled() {
    return import.meta.env.VITE_DYNAMIC_FORM === '1';
}

/** Pub-token links always use the dynamic public form path. */
export function shouldUsePublicDynamicForm(searchParams) {
    const pub = searchParams.get('pub');
    const isPreview = searchParams.get('preview') === '1';
    return Boolean(pub?.trim()) && !isPreview;
}
