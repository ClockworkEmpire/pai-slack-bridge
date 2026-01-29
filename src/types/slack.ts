// Slack-specific types for file attachments, blocks, and interactive elements

/**
 * Slack file attachment (from message events with files)
 */
export interface SlackFile {
  id: string;
  name: string;
  mimetype: string;
  size: number;
  url_private: string;
  url_private_download?: string;
  filetype?: string;
  thumb_720?: string;
  thumb_960?: string;
  thumb_1024?: string;
  mode?: string;
}

/**
 * Slack Block Kit button element
 */
export interface SlackButton {
  type: 'button';
  text: {
    type: 'plain_text';
    text: string;
    emoji?: boolean;
  };
  action_id: string;
  value: string;
  style?: 'primary' | 'danger';
}

/**
 * Slack Block Kit block types used by the bridge
 */
export type SlackBlock =
  | {
      type: 'section';
      text: {
        type: 'mrkdwn' | 'plain_text';
        text: string;
      };
    }
  | {
      type: 'actions';
      elements: SlackButton[];
    }
  | {
      type: 'divider';
    };

/**
 * Supported file extensions for inbound downloads
 */
export const SUPPORTED_INBOUND_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp',
  'pdf',
  'txt', 'md', 'csv', 'json', 'ts', 'js',
]);

/**
 * Max file size for inbound downloads (10MB)
 */
export const MAX_INBOUND_FILE_SIZE = 10 * 1024 * 1024;
