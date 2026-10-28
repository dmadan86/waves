/**
 * The company's shared expense tags in one sheet. Everyone sees the list and can add
 * a tag; an admin can also rename, hide and add an industry's ready-made tags.
 * Nothing is deleted — a hidden tag stays on the entries that already use it.
 */

import { useMemo, useState } from 'react';
import { Pressable, TextInput, View } from 'react-native';

import { Button, Chip, Sheet, Text, useTheme } from '@waves/ui';

import { fill, useStrings } from '@/i18n';

export interface TagRow {
  readonly key: string;
  readonly label: string;
  readonly unit?: string | null;
  readonly hidden: boolean;
  /** Who added it, already resolved to a name. */
  readonly addedBy?: string | null;
}

export interface IndustryOption {
  readonly id: string;
  readonly label: string;
  /** How many of its tags are not in the list yet. */
  readonly missing: number;
}

export function CompanyTagsSheet({
  visible,
  onClose,
  rows,
  isAdmin,
  industries,
  onAdd,
  onRename,
  onToggleHidden,
  onAddPack,
  onPick,
}: {
  visible: boolean;
  onClose: () => void;
  rows: readonly TagRow[];
  isAdmin: boolean;
  industries: readonly IndustryOption[];
  onAdd: (label: string) => void;
  onRename: (key: string, label: string) => void;
  onToggleHidden: (key: string) => void;
  onAddPack: (id: string) => void;
  /** Tap a tag's name to choose it for the entry and close. */
  onPick: (key: string) => void;
}) {
  const theme = useTheme();
  const { t } = useStrings();
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editText, setEditText] = useState('');

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? rows.filter((r) => r.label.toLowerCase().includes(q)) : rows;
  }, [rows, query]);

  const input = {
    color: theme.color.text,
    fontSize: 16,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: theme.color.border,
  } as const;

  return (
    <Sheet visible={visible} onClose={onClose} title={t.company.tagsTitle}>
      <View style={{ gap: theme.spacing.md }}>
        <Text variant="caption" tone="muted">
          {t.company.tagsShared}
        </Text>
        {rows.length > 8 ? (
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t.company.tagsSearch}
            placeholderTextColor={theme.color.textMuted}
            accessibilityLabel={t.company.tagsSearch}
            style={input}
          />
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            placeholder={t.company.tagNamePh}
            placeholderTextColor={theme.color.textMuted}
            maxLength={40}
            accessibilityLabel={t.company.tagNew}
            style={[input, { flex: 1 }]}
          />
          <Button
            label={t.company.tagAdd}
            disabled={draft.trim() === ''}
            onPress={() => {
              onAdd(draft.trim());
              setDraft('');
            }}
          />
        </View>
        {shown.map((row) => (
          <View
            key={row.key}
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.spacing.sm }}
          >
            {editing === row.key ? (
              <>
                <TextInput
                  autoFocus
                  value={editText}
                  onChangeText={setEditText}
                  maxLength={40}
                  style={[input, { flex: 1 }]}
                  accessibilityLabel={t.company.tagRename}
                />
                <Button
                  label={t.company.tagSave}
                  disabled={editText.trim() === ''}
                  onPress={() => {
                    onRename(row.key, editText.trim());
                    setEditing(null);
                  }}
                />
              </>
            ) : (
              <>
                <Pressable
                  accessibilityRole="button"
                  disabled={row.hidden}
                  onPress={() => onPick(row.key)}
                  style={{ flex: 1 }}
                >
                  <Text variant="body" tone={row.hidden ? 'muted' : undefined}>
                    {row.unit ? `${row.label} · ${row.unit}` : row.label}
                  </Text>
                  {row.addedBy ? (
                    <Text variant="micro" tone="muted">
                      {fill(t.company.tagAddedBy, { name: row.addedBy })}
                    </Text>
                  ) : null}
                </Pressable>
                {isAdmin ? (
                  <>
                    <Pressable
                      accessibilityRole="button"
                      onPress={() => {
                        setEditing(row.key);
                        setEditText(row.label);
                      }}
                    >
                      <Text variant="caption" tone="muted">
                        {t.company.tagRename}
                      </Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => onToggleHidden(row.key)}>
                      <Text variant="caption" tone="muted">
                        {row.hidden ? t.company.tagShow : t.company.tagHide}
                      </Text>
                    </Pressable>
                  </>
                ) : null}
              </>
            )}
          </View>
        ))}
        {isAdmin ? (
          <View style={{ gap: theme.spacing.sm }}>
            <Text variant="caption" tone="muted">
              {t.company.industryTitle}
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: theme.spacing.sm }}>
              {industries.map((industry) => (
                <Chip
                  key={industry.id}
                  onCard
                  label={
                    industry.missing > 0
                      ? `${industry.label} · ${fill(t.company.packAdd, { n: industry.missing })}`
                      : industry.label
                  }
                  onPress={industry.missing > 0 ? () => onAddPack(industry.id) : undefined}
                />
              ))}
            </View>
          </View>
        ) : null}
      </View>
    </Sheet>
  );
}
