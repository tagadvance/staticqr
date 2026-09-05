/** Substitute {name} placeholders in a translated string. */
export function format(template, values) {
	return template.replace(/\{(\w+)\}/g, (match, key) =>
		Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : match,
	);
}

/** Load the string table for the language this page was built in. */
export async function loadStrings() {
	const lang = document.documentElement.lang || 'en';
	const module = await import(`/assets/strings.${lang}.js`);
	return module.strings;
}
