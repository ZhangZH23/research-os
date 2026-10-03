# Research engine fixtures

`synthetic-semantics.json` contains 48 **synthetic engineering fixtures**, not expert-annotated real research. Each includes a compact before-state, new material, expected checks/effects, explicit unknowns, and reviewer explanation. The compact graph DSL is expanded to the actual shared typed records by `tests/engine-semantics.test.ts`; the actual pure checker/support evaluator runs against those records.

The `requirements` list references fixture coverage items in the upgrade specification. More than one fixture can cover an item. Requirements concerning transactions, API authorization, late model responses, public snapshot isolation, retrieval, migration, and cloud restart are intentionally not misrepresented as pure semantic tests. They require separate domain/cloud tests.

Run:

```sh
node --import tsx --test tests/engine-semantics.test.ts
```

To contribute real research examples, follow `docs/CHECKERS.md`: obtain permission, preserve attribution and exact source mapping, label redactions, record independent reviewer disagreements, and hold out complete projects. Never commit API keys, private transcripts, or unapproved research merely to improve fixture realism.

`synthetic-integration-catalog.json` maps the seven transaction/project/publication/retrieval/restart requirements that cannot be exercised by a pure checker to concrete existing test names in `engine-domain.test.ts`, `engine-cloud.test.ts`, and `project-scope.test.ts`. The catalog includes before-state, proposed action, expected state effect, unknowns, and interpretation. The semantic suite validates the links; the linked integration suites must actually run to validate the behaviors. A catalog entry is not itself a passing test report.
