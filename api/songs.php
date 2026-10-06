<?php
// Song lessons backend. Called by server.js (never over the web): the request is sent as JSON on stdin
// ({"userId": "...", "action": "list"|"get"|"step"|"complete", "slug": "...", "step": 0, "checked": true, "done": true})
// and the reply is JSON on stdout. server.js has already verified the session, so userId can be trusted.
if (PHP_SAPI !== 'cli') { http_response_code(403); exit; }

require __DIR__ . '/songs-data.php';

const DATA_FILE = __DIR__ . '/../data/progress.json';

function reply(int $status, array $body): never {
    echo json_encode(['status' => $status, 'body' => $body]);
    exit;
}

// Runs $callback with the decoded database under an exclusive lock; saves it when $save is set to true.
function withDatabase(callable $callback): mixed {
    $dir = dirname(DATA_FILE);
    if (!is_dir($dir)) mkdir($dir, 0700, true);
    $handle = fopen(DATA_FILE, 'c+');
    if (!$handle || !flock($handle, LOCK_EX)) reply(500, ['code' => 'SERVER_ERROR', 'message' => 'Could not open progress data.']);
    $db = json_decode(stream_get_contents($handle) ?: '', true);
    if (!is_array($db) || !isset($db['users']) || !is_array($db['users'])) $db = ['users' => []];
    $save = false;
    $result = $callback($db, $save);
    if ($save) {
        ftruncate($handle, 0);
        rewind($handle);
        fwrite($handle, json_encode($db));
        fflush($handle);
    }
    flock($handle, LOCK_UN);
    fclose($handle);
    return $result;
}

// A song is "done" once every practice step is ticked.
function present(array $song, array $steps): array {
    $steps = array_values(array_unique(array_filter($steps, fn($i) => is_int($i) && $i >= 0 && $i < count($song['steps']))));
    sort($steps);
    return $song + ['completedSteps' => $steps, 'done' => count($steps) === count($song['steps'])];
}

$input = json_decode(stream_get_contents(STDIN) ?: '', true);
$userId = is_array($input) && is_string($input['userId'] ?? null) ? $input['userId'] : '';
$action = is_array($input) ? ($input['action'] ?? '') : '';
if ($userId === '') reply(400, ['code' => 'INVALID_INPUT', 'message' => 'A user is required.']);

$catalogue = songCatalogue();
$bySlug = array_column($catalogue, null, 'slug');

if ($action === 'list') {
    $progress = withDatabase(fn(array &$db) => $db['users'][$userId]['songs'] ?? []);
    $songs = array_map(fn($song) => present($song, $progress[$song['slug']]['steps'] ?? []), $catalogue);
    reply(200, ['songs' => $songs, 'doneCount' => count(array_filter($songs, fn($s) => $s['done']))]);
}

$slug = is_string($input['slug'] ?? null) ? $input['slug'] : '';
if (!isset($bySlug[$slug])) reply(404, ['code' => 'NOT_FOUND', 'message' => 'Song not found.']);
$song = $bySlug[$slug];
$count = count($song['steps']);
$slugs = array_keys($bySlug);
$position = array_search($slug, $slugs, true);
$neighbours = [
    'previous' => $position > 0 ? ['slug' => $slugs[$position - 1], 'title' => $bySlug[$slugs[$position - 1]]['title']] : null,
    'next' => $position < count($slugs) - 1 ? ['slug' => $slugs[$position + 1], 'title' => $bySlug[$slugs[$position + 1]]['title']] : null,
];

if ($action === 'get') {
    $steps = withDatabase(fn(array &$db) => $db['users'][$userId]['songs'][$slug]['steps'] ?? []);
    reply(200, ['song' => present($song, $steps)] + $neighbours);
}

if ($action === 'step' || $action === 'complete') {
    if ($action === 'step') {
        $step = $input['step'] ?? null;
        if (!is_int($step) || $step < 0 || $step >= $count || !is_bool($input['checked'] ?? null)) reply(400, ['code' => 'INVALID_INPUT', 'message' => 'Invalid practice step.']);
    } elseif (!is_bool($input['done'] ?? null)) {
        reply(400, ['code' => 'INVALID_INPUT', 'message' => 'Invalid request.']);
    }
    $steps = withDatabase(function (array &$db, &$save) use ($userId, $slug, $count, $action, $input) {
        $steps = $db['users'][$userId]['songs'][$slug]['steps'] ?? [];
        if ($action === 'complete') {
            $steps = $input['done'] ? range(0, $count - 1) : [];
        } elseif ($input['checked']) {
            $steps[] = $input['step'];
        } else {
            $steps = array_diff($steps, [$input['step']]);
        }
        $steps = array_values(array_unique($steps));
        sort($steps);
        $db['users'][$userId]['songs'][$slug] = ['steps' => $steps, 'updatedAt' => gmdate('c')];
        $save = true;
        return $steps;
    });
    reply(200, ['song' => present($song, $steps)] + $neighbours);
}

reply(400, ['code' => 'INVALID_ACTION', 'message' => 'Unknown action.']);
