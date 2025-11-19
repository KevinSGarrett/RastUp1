# Template Assets

Store MJML source and localized variants for communications templates.

## File Naming

- `booking_confirmed_buyer.en-US.mjml`
- `booking_confirmed_buyer.es-US.mjml`
- `booking_confirmed_buyer.rendered.html` (compiled snapshot)

Include metadata header in MJML files:

```
---
template: booking_confirmed_buyer
locale: en-US
version: 1
reviewed_by:
  - name: "Jane Doe"
    role: "Comms"
    date: "2025-11-18"
---
```

## Workflow

1. Edit MJML template.
2. Run `python tools/comms/render_templates.py --template booking_confirmed_buyer`.
3. Review generated HTML snapshot (dark/light modes).
4. Submit PR including MJML + rendered HTML + updated variable schema if needed.

