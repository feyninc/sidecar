/** Directory-style widgets for Notion users, workspace identity, and teams. */
import { Avatar, Heading, Stack, Surface, Text } from "@sidecar-ai/native/components";
import {
  cleanTitle,
  PeopleSkeleton,
  previewItems,
  ResultList,
  ResultsSkeleton,
  useNotionResult,
  WidgetHeader,
  WidgetShell
} from "./NotionPrimitives.js";

/** One-person profile view for `notion-get-user` and `notion-get-self`. */
export function NotionPersonWidget() {
  const result = useNotionResult();
  if (!result) {
    return <PeopleSkeleton />;
  }

  const title = cleanTitle(result.preview.title, "Notion user");
  return (
    <WidgetShell>
      <Stack gap="lg">
        <Surface variant="plain" className="notion-profile-card">
          <Avatar name={title} size={44} />
          <Stack gap="xs">
            <Heading level={1} className="notion-title">
              {title}
            </Heading>
            <Text tone="muted" className="notion-summary">
              {result.preview.summary}
            </Text>
          </Stack>
        </Surface>
      </Stack>
    </WidgetShell>
  );
}

/** User directory view for `notion-get-users`. */
export function NotionPeopleWidget() {
  const result = useNotionResult();
  if (!result) {
    return <PeopleSkeleton />;
  }

  const people = previewItems(result);
  return (
    <WidgetShell>
      <Stack gap="lg">
        <WidgetHeader title="Workspace users" summary={result.preview.summary} />
        {people.length ? (
          <Stack gap="sm">
            {people.map((person, index) => (
              <Surface key={`${person.title}-${index}`} variant="plain" className="notion-person-row">
                <Avatar name={person.title} size={34} />
                <Stack gap="xs">
                  <Heading level={3} className="notion-row-title">
                    {person.title}
                  </Heading>
                  {person.body ? (
                    <Text tone="muted" className="notion-row-body">
                      {person.body}
                    </Text>
                  ) : null}
                </Stack>
              </Surface>
            ))}
          </Stack>
        ) : (
          <Text tone="muted">No users were returned.</Text>
        )}
      </Stack>
    </WidgetShell>
  );
}

/** Teamspace list for `notion-get-teams`. */
export function NotionTeamsWidget() {
  const result = useNotionResult();
  if (!result) {
    return <ResultsSkeleton />;
  }

  return (
    <WidgetShell>
      <Stack gap="lg">
        <WidgetHeader title="Teamspaces" summary={result.preview.summary} />
        <ResultList empty="No teamspaces were returned." items={previewItems(result)} />
      </Stack>
    </WidgetShell>
  );
}
