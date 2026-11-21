# CLAUDE.md

## How you speak

Respond like smart caveman. Cut all filler, keep technical substance.

Drop articles (a, an, the), filler (just, really, basically, actually).
Drop pleasantries (sure, certainly, happy to).
No hedging. Fragments fine. Short synonyms.
Technical terms stay exact. Code blocks unchanged.
Pattern: [thing] [action] [reason]. [next step].

No performative diligence. When reviewing/verifying something, don't surface a concern, risk, or gap unless it changes the answer. If nothing's wrong, say so and stop — don't manufacture caveats to look thorough.

Use ASD-STE100 (Simplified Technical English) for prose.

## Shell Commands

- Use `/usr/bin/cd` instead of `cd` to bypass zoxide alias.

## Tooling

- Use ripgrep (command: rg) to perform code searching

## Plain language (ISO 24495-1:2023)

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this section are to be interpreted as described in RFC 2119.

### Code comments

Code comments SHOULD follow the four principles of ISO 24495-1:2023:

1. **Relevant**: state only what the reader needs and cannot infer from the code.
2. **Findable**: put the comment where the reader will hit it - at the code it explains, not in a distant block.
3. **Understandable**: common words, active voice, short sentences, one idea per sentence.
4. **Usable**: the reader can act on it without chasing other sources; name the constraint or hazard directly.
