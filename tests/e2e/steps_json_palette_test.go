package e2e

import (
	"fmt"
	"strings"
	"time"

	"github.com/chromedp/chromedp"
	"github.com/cucumber/godog"
)

func registerJSONPaletteSteps(context *godog.ScenarioContext, world *browserWorld) {
	context.Step(`^a highlighted JSON document contains HTML-like text and enough lines to scroll$`, world.jsonPreparePaletteDocument)
	context.Step(`^I try all three JSON color palettes$`, world.jsonTryAllPalettes)
	context.Step(`^each palette changes the rendered colors while preserving text, selection, and scroll$`, world.jsonPalettesPreserveEditors)
	context.Step(`^the selected JSON palette survives mode changes, workspace navigation, and reload$`, world.jsonPalettePersists)
}

func (w *browserWorld) jsonPaletteCheck(expression string) error {
	var problem string
	if err := w.run(chromedp.Evaluate(expression, &problem)); err != nil {
		return err
	}
	if problem != "" {
		return fmt.Errorf("JSON palette: %s", problem)
	}
	return nil
}

func (w *browserWorld) jsonPreparePaletteDocument() error {
	rows := make([]string, 80)
	for index := range rows {
		rows[index] = fmt.Sprintf(`  {"id":%d,"message":"<img data-palette-injection src=x> & </textarea><script data-palette-injection>bad()</script>","active":true,"optional":null}`, index)
	}
	if err := w.jsonSetControl("source", "[\n"+strings.Join(rows, ",\n")+"\n]\n"); err != nil {
		return err
	}
	if err := w.jsonRunOperation("format and sort"); err != nil {
		return err
	}
	return w.jsonPaletteCheck(`(() => {
		const page = document.querySelector('.json-lab-page');
		const options = [...page.querySelectorAll('input[name="json-palette"][data-json-control="palette"]')];
		if (page.dataset.jsonPalette !== 'firefox') return 'Firefox is not the default palette';
		if (options.length !== 3 || options.map(option => option.value).sort().join() !== 'dracula,firefox,github') {
			return 'expected exactly the Firefox, GitHub, and Dracula palette radios';
		}
		for (const [id, label] of [['firefox', 'Firefox'], ['github', 'GitHub'], ['dracula', 'Dracula']]) {
			const radio = options.find(option => option.value === id);
			if (radio.type !== 'radio' || ![...radio.labels].some(element => element.textContent.includes(label))) {
				return id + ' does not have an accessible radio label';
			}
		}
		const source = page.querySelector('[data-json-control="source"]');
		const result = page.querySelector('[data-json-slot="result"] textarea');
		const editors = [source, result];
		const kinds = ['key', 'string', 'number', 'literal', 'punctuation'];
		for (const editor of editors) {
			const highlight = editor.closest('.json-code-editor')?.querySelector('.json-code-highlight');
			if (!highlight || highlight.getAttribute('aria-hidden') !== 'true') return 'highlight is missing or exposed to screen readers';
			if (highlight.textContent !== editor.value + '\n') return 'highlight does not preserve the full input, including its trailing newline';
			if (highlight.querySelector('[data-palette-injection], img, script, textarea')) return 'JSON text was interpreted as HTML';
			for (const kind of kinds) {
				if (!highlight.querySelector('.json-syntax-' + kind)) return 'missing highlighted ' + kind + ' token';
			}
			editor.setSelectionRange(10, 16);
			editor.scrollTop = editor.scrollHeight;
			editor.scrollLeft = editor.scrollWidth;
			editor.dispatchEvent(new Event('scroll'));
			if (Math.abs(highlight.scrollTop - editor.scrollTop) > 1 || Math.abs(highlight.scrollLeft - editor.scrollLeft) > 1) {
				return 'highlight does not align at the end of the document';
			}
			editor.scrollTop = 160;
			editor.scrollLeft = 24;
			editor.dispatchEvent(new Event('scroll'));
			if (editor.scrollTop <= 0 || Math.abs(highlight.scrollTop - editor.scrollTop) > 1) return 'highlight does not follow textarea scrolling';
		}
		globalThis.__VALIDEX_E2E_JSON_PALETTES__ = {
			editors: editors.map(editor => ({
				element: editor, value: editor.value, start: editor.selectionStart,
				end: editor.selectionEnd, top: editor.scrollTop, left: editor.scrollLeft
			})),
			colors: {}, kinds
		};
		return '';
	})()`)
}

func (w *browserWorld) jsonTryAllPalettes() error {
	for _, palette := range []string{"firefox", "github", "dracula"} {
		selector := fmt.Sprintf(`label.json-palette-option[data-json-palette="%s"]`, palette)
		if err := w.run(
			chromedp.Click(selector, chromedp.ByQuery),
			chromedp.Poll(
				fmt.Sprintf(`document.querySelector('.json-lab-page')?.dataset.jsonPalette === %s`, jsonQuoted(palette)),
				nil,
				chromedp.WithPollingTimeout(3*time.Second),
			),
		); err != nil {
			return fmt.Errorf("select %s JSON palette: %w", palette, err)
		}
		if err := w.jsonPaletteCheck(`(() => {
			const page = document.querySelector('.json-lab-page');
			const palette = page.dataset.jsonPalette;
			const state = globalThis.__VALIDEX_E2E_JSON_PALETTES__;
			const selected = page.querySelector('input[name="json-palette"]:checked');
			if (selected?.value !== palette) return 'selected radio does not match ' + palette;
			const current = [page.querySelector('[data-json-control="source"]'), page.querySelector('[data-json-slot="result"] textarea')];
			for (const [index, saved] of state.editors.entries()) {
				const editor = current[index];
				if (editor !== saved.element || editor.value !== saved.value) return palette + ' replaced an editor or changed its text';
				if (editor.selectionStart !== saved.start || editor.selectionEnd !== saved.end) return palette + ' changed the selection';
				if (editor.scrollTop !== saved.top || editor.scrollLeft !== saved.left) return palette + ' changed the scroll position';
				const highlight = editor.closest('.json-code-editor').querySelector('.json-code-highlight');
				if (highlight.textContent !== editor.value + '\n') return palette + ' changed highlighted text';
				if (Math.abs(highlight.scrollTop - editor.scrollTop) > 1) return palette + ' lost scroll synchronization';
			}
			state.colors[palette] = state.editors.map(({element}) => state.kinds.map(kind => {
				const token = element.closest('.json-code-editor').querySelector('.json-syntax-' + kind);
				return getComputedStyle(token).color;
			}));
			return '';
		})()`); err != nil {
			return err
		}
	}
	return nil
}

func (w *browserWorld) jsonPalettesPreserveEditors() error {
	return w.jsonPaletteCheck(`(() => {
		const colors = globalThis.__VALIDEX_E2E_JSON_PALETTES__?.colors;
		if (!colors || Object.keys(colors).length !== 3) return 'not all palettes were checked';
		for (const index of [0, 1]) {
			const signatures = Object.values(colors).map(editors => editors[index].join('|'));
			if (new Set(signatures).size !== 3) return 'palettes do not render three distinct sets of syntax colors';
			for (const editors of Object.values(colors)) {
				if (new Set(editors[index]).size < 3) return 'syntax categories are not visibly differentiated';
			}
		}
		return localStorage.getItem('validex.json-palette') === 'dracula' ? '' : 'palette preference was not saved';
	})()`)
}

func (w *browserWorld) jsonPalettePersists() error {
	check := func() error {
		return w.jsonPaletteCheck(`(() => {
			const page = document.querySelector('.json-lab-page');
			return page?.dataset.jsonPalette === 'dracula' &&
				page.querySelector('input[name="json-palette"]:checked')?.value === 'dracula'
				? '' : 'Dracula preference was not restored';
		})()`)
	}
	if err := w.jsonOpenMode("Diff"); err != nil {
		return err
	}
	if err := check(); err != nil {
		return err
	}
	if err := w.openNamedWorkspace("Requests"); err != nil {
		return err
	}
	if err := w.openNamedWorkspace("JSON"); err != nil {
		return err
	}
	if err := check(); err != nil {
		return err
	}
	if err := w.run(chromedp.Reload(), chromedp.WaitVisible("[data-activity]", chromedp.ByQuery)); err != nil {
		return err
	}
	if err := w.openNamedWorkspace("JSON"); err != nil {
		return err
	}
	return check()
}
