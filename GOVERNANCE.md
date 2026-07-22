# Governance

PageRoot currently uses a maintainer-led governance model.

The repository owner is responsible for project direction, security releases, merge decisions, release signing policy and the use of project branding. Contributors participate through Issues, Discussions and Pull Requests. Significant protocol, persistence, security or compatibility changes should be proposed before implementation and documented as an architecture decision when accepted.

Routine changes are merged after review and required CI. The maintainer may use squash merging to keep `main` linear and may close changes that conflict with the source-fidelity or security model. Releases are created only from immutable tags on `main`; published release assets are never silently replaced.

Governance can evolve as the contributor base grows. Material changes to this document should be discussed publicly in the repository.
