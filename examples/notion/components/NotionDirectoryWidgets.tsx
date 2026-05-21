/** Directory-style widgets for Notion users, workspace identity, and teams. */
import { Avatar, Heading, Stack, Surface, Text } from "@sidecar-ai/native/components";
import {
  cleanTitle,
  MissingResultFallback,
  PeopleSkeleton,
  previewItems,
  ResultList,
  ResultsSkeleton,
  useNotionResultState,
  WidgetHeader,
  WidgetShell
} from "./NotionPrimitives.js";

/** One-person profile view for `notion-get-self`. */
export function NotionSelfWidget() {
  return <NotionPersonWidget toolName="notion-get-self" retry="emptyArgs" />;
}

/** One-person profile view for `notion-get-user`. */
export function NotionUserWidget() {
  return <NotionPersonWidget toolName="notion-get-user" retry="withArgs" />;
}

function NotionPersonWidget({ retry, toolName }: { retry: "emptyArgs" | "withArgs"; toolName: string }) {
  const state = useNotionResultState({ toolName, retry });
  if (state.status === "loading") {
    return <PeopleSkeleton />;
  }
  if (state.status === "missing") {
    return <MissingResultFallback retry={state.retry} title="User preview unavailable" />;
  }

  const { result } = state;
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
  const state = useNotionResultState({ toolName: "notion-get-users", retry: "withArgs" });
  if (state.status === "loading") {
    return <PeopleSkeleton />;
  }
  if (state.status === "missing") {
    return <MissingResultFallback retry={state.retry} title="Users preview unavailable" />;
  }

  const { result } = state;
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
  const state = useNotionResultState({ toolName: "notion-get-teams", retry: "withArgs" });
  if (state.status === "loading") {
    return <ResultsSkeleton />;
  }
  if (state.status === "missing") {
    return <MissingResultFallback retry={state.retry} title="Teamspace preview unavailable" />;
  }

  const { result } = state;
  return (
    <WidgetShell>
      <Stack gap="lg">
        <WidgetHeader title="Teamspaces" summary={result.preview.summary} />
        <ResultList empty="No teamspaces were returned." items={previewItems(result)} />
      </Stack>
    </WidgetShell>
  );
}
