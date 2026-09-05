/**
 * Refuse to run inside someone else's frame.
 *
 * The correct fix for clickjacking is `frame-ancestors` or X-Frame-Options,
 * and neither is available here: both are response headers, GitHub Pages does
 * not let you set headers, and `frame-ancestors` is one of the three
 * directives a browser ignores when the policy arrives in a <meta> tag. So
 * this is the fallback, and it does two separate things because either can be
 * blocked on its own:
 *
 *   1. Hides the page, which works even when the frame forbids navigation.
 *   2. Tries to replace the framing page, which works when it does not.
 *
 * An attacker can stop the script running at all with `sandbox` minus
 * `allow-scripts` — but that also stops every control on this page working,
 * and a clickjack on inert markup achieves nothing.
 *
 * The attribute goes on <html> rather than a style being injected, so the
 * rule can live in the stylesheet and the content security policy can stay at
 * `style-src 'self'` with no inline exception. Nothing is hidden by default,
 * so a reader without JavaScript, and a crawler, still see the whole page.
 */
if (window.top !== window.self) {
	document.documentElement.setAttribute('data-framed', '');
	try {
		window.top.location = window.self.location;
	} catch {
		// Cross-origin, or sandboxed without allow-top-navigation. The page
		// stays hidden, which is the outcome that matters.
	}
}
