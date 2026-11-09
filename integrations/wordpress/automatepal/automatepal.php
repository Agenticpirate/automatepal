<?php
/**
 * Plugin Name:       AutomatePal Support Chat
 * Plugin URI:        https://automatepal.com/docs
 * Description:       Adds your AutomatePal support chat to every public page. Paste your install key under Settings › AutomatePal.
 * Version:           1.0.0
 * Requires at least: 6.3
 * Requires PHP:      7.4
 * Author:            AutomatePal
 * License:           MIT
 * License URI:       https://opensource.org/licenses/MIT
 * Text Domain:       automatepal
 */

if (!defined('ABSPATH')) {
	exit;
}

const AUTOMATEPAL_OPTION = 'automatepal_settings';
const AUTOMATEPAL_DEFAULT_APP = 'https://automatepal.com';

/** Saved settings with defaults. */
function automatepal_settings() {
	$saved = get_option(AUTOMATEPAL_OPTION, array());
	return wp_parse_args(is_array($saved) ? $saved : array(), array('key' => '', 'app' => AUTOMATEPAL_DEFAULT_APP, 'enabled' => '1'));
}

/** Install keys are public by design: pk_live_ or pk_test_ plus 24 letters and digits. */
function automatepal_valid_key($key) {
	return is_string($key) && preg_match('/^pk_(live|test)_[A-Za-z0-9]{24}$/', $key) === 1;
}

/** The app address must be a bare https origin (no path), so the script can only come from there. */
function automatepal_valid_app($app) {
	if (!is_string($app) || strlen($app) > 200) {
		return false;
	}
	$parts = wp_parse_url($app);
	return is_array($parts) && ($parts['scheme'] ?? '') === 'https' && !empty($parts['host'])
		&& empty($parts['path']) && empty($parts['query']) && empty($parts['user']) && empty($parts['pass']);
}

/** Front end: one async script in the footer. The key goes in the URL so caching and optimisation plugins
 *  that rewrite script tags cannot drop it. Nothing loads in wp-admin. */
function automatepal_enqueue() {
	$s = automatepal_settings();
	if ($s['enabled'] !== '1' || !automatepal_valid_key($s['key']) || !automatepal_valid_app($s['app'])) {
		return;
	}
	$src = add_query_arg('bot', rawurlencode($s['key']), untrailingslashit($s['app']) . '/widget.js');
	wp_enqueue_script('automatepal-widget', $src, array(), null, array('in_footer' => true, 'strategy' => 'async'));
}
add_action('wp_enqueue_scripts', 'automatepal_enqueue');

/** Settings › AutomatePal. Uses the Settings API (nonce and capability checks included). */
function automatepal_register_settings() {
	register_setting('automatepal', AUTOMATEPAL_OPTION, array(
		'type'              => 'array',
		'sanitize_callback' => 'automatepal_sanitize',
		'default'           => array(),
	));
}
add_action('admin_init', 'automatepal_register_settings');

function automatepal_sanitize($input) {
	$old = automatepal_settings();
	$key = isset($input['key']) ? trim(sanitize_text_field(wp_unslash($input['key']))) : '';
	$app = isset($input['app']) ? untrailingslashit(trim(esc_url_raw(wp_unslash($input['app'])))) : AUTOMATEPAL_DEFAULT_APP;
	if ($key !== '' && !automatepal_valid_key($key)) {
		add_settings_error(AUTOMATEPAL_OPTION, 'automatepal_key', __('That does not look like an install key. Copy it from Setup › Install on your site; it starts with pk_live_ or pk_test_.', 'automatepal'));
		$key = $old['key'];
	}
	if (!automatepal_valid_app($app)) {
		add_settings_error(AUTOMATEPAL_OPTION, 'automatepal_app', __('The app address must be an https address without a path, for example https://automatepal.com.', 'automatepal'));
		$app = $old['app'];
	}
	return array('key' => $key, 'app' => $app, 'enabled' => empty($input['enabled']) ? '0' : '1');
}

function automatepal_menu() {
	add_options_page(__('AutomatePal', 'automatepal'), __('AutomatePal', 'automatepal'), 'manage_options', 'automatepal', 'automatepal_page');
}
add_action('admin_menu', 'automatepal_menu');

function automatepal_page() {
	if (!current_user_can('manage_options')) {
		return;
	}
	$s = automatepal_settings();
	?>
	<div class="wrap">
		<h1><?php esc_html_e('AutomatePal Support Chat', 'automatepal'); ?></h1>
		<p><?php esc_html_e('Paste the install key from your AutomatePal dashboard (Setup › Install on your site). Also add this site\'s address to the allowed origins in Widget studio, or the chat will not appear.', 'automatepal'); ?></p>
		<form method="post" action="options.php">
			<?php settings_fields('automatepal'); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="automatepal-key"><?php esc_html_e('Install key', 'automatepal'); ?></label></th>
					<td><input id="automatepal-key" class="regular-text code" name="<?php echo esc_attr(AUTOMATEPAL_OPTION); ?>[key]" value="<?php echo esc_attr($s['key']); ?>" placeholder="pk_live_…" autocomplete="off" spellcheck="false"></td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e('Show the chat', 'automatepal'); ?></th>
					<td><label><input type="checkbox" name="<?php echo esc_attr(AUTOMATEPAL_OPTION); ?>[enabled]" value="1" <?php checked($s['enabled'], '1'); ?>> <?php esc_html_e('On every public page', 'automatepal'); ?></label></td>
				</tr>
				<tr>
					<th scope="row"><label for="automatepal-app"><?php esc_html_e('App address', 'automatepal'); ?></label></th>
					<td><input id="automatepal-app" class="regular-text code" name="<?php echo esc_attr(AUTOMATEPAL_OPTION); ?>[app]" value="<?php echo esc_attr($s['app']); ?>">
						<p class="description"><?php esc_html_e('Leave as https://automatepal.com unless support told you otherwise.', 'automatepal'); ?></p></td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>
	</div>
	<?php
}

/** Settings link on the Plugins screen. */
function automatepal_action_links($links) {
	array_unshift($links, '<a href="' . esc_url(admin_url('options-general.php?page=automatepal')) . '">' . esc_html__('Settings', 'automatepal') . '</a>');
	return $links;
}
add_filter('plugin_action_links_' . plugin_basename(__FILE__), 'automatepal_action_links');
