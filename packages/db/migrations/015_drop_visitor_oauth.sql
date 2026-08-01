-- packages/db/migrations/015_drop_visitor_oauth.sql
-- Takes out the two tables the visitor OAuth needed. Nothing writes to either one
-- any more: the flows, the token store and the visitor branch in the mediator have
-- all gone.
--
-- Why the feature went, so this file is not the only place the decision is not
-- written down: a stranger does not hand a portfolio page OAuth with write access to
-- their CRM. Against nobody using it stood an encrypted store of other people's
-- credentials, a data protection surface, an abuse surface, and a branch between
-- house and visitor at three points in the delivery path. The visitor's own endpoint
-- does the same job, a record landing in a system we do not control with the retry
-- mechanic visible from the other side, and it takes a url and no login.
--
-- Dropped rather than left standing. An empty table is cheap; a table shaped to hold
-- other people's access tokens, sitting in a database with nothing left to write to
-- it, is a thing somebody will one day fill in again without reading any of this.
--
-- Not reversible, and that is the point. Restoring the feature means restoring the
-- flows and the store as well, which is a decision to be taken again rather than a
-- migration to be run backwards.

DROP TABLE IF EXISTS oauth_tokens;

-- The other half of the same feature. It stood in for the channel history we could
-- not read in a visitor's workspace, because we asked for permission to post and
-- none to read. With no visitor workspace there is nothing it remembers.
DROP TABLE IF EXISTS slack_visitor_sends;
