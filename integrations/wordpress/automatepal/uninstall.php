<?php
// Removes the plugin's one option when the plugin is deleted from the Plugins screen.
if (!defined('WP_UNINSTALL_PLUGIN')) {
	exit;
}
delete_option('automatepal_settings');
