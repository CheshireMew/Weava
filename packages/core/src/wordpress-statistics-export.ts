import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WeavaError } from '@weava/contracts';
import { digest } from './storage.ts';

// Standalone PHP: deliberately does not include wp-load.php or execute wp-config.php.
// The generated script is transported by SSH; credentials remain on the source host.
export const wordpressStatisticsPhp = String.raw`<?php
declare(strict_types=1);
$root = base64_decode('__WEAVA_WORDPRESS_ROOT__', true);
function snapshotJson($value): string {
    return json_encode($value, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS | JSON_THROW_ON_ERROR);
}
function configLiteral($token): string {
    if (!is_array($token) || $token[0] !== T_CONSTANT_ENCAPSED_STRING) throw new RuntimeException('Database configuration must use literal strings; no WordPress code was executed.');
    $text = $token[1]; $value = substr($text, 1, -1);
    return $text[0] === "'" ? str_replace(["\\\\", "\\'"], ["\\", "'"], $value) : stripcslashes($value);
}
$connection = null;
try {
    mysqli_report(MYSQLI_REPORT_ERROR | MYSQLI_REPORT_STRICT);
    $config = file_get_contents($root . '/wp-config.php');
    if ($config === false) throw new RuntimeException('Cannot read wp-config.php.');
    $tokens = array_values(array_filter(token_get_all($config), fn($t) => !is_array($t) || !in_array($t[0], [T_WHITESPACE, T_COMMENT, T_DOC_COMMENT], true)));
    $credentials = []; $prefix = null;
    foreach ($tokens as $index => $token) {
        if (is_array($token) && $token[0] === T_STRING && strtolower($token[1]) === 'define' && ($tokens[$index+1] ?? null) === '(') {
            if (!is_array($tokens[$index+2] ?? null) || $tokens[$index+2][0] !== T_CONSTANT_ENCAPSED_STRING) continue;
            $key = configLiteral($tokens[$index+2]);
            if (in_array($key, ['DB_NAME','DB_USER','DB_PASSWORD','DB_HOST'], true)) {
                if (($tokens[$index+3] ?? null) !== ',' || !in_array($tokens[$index+5] ?? null, [')', ','], true)) throw new RuntimeException('Unsupported database configuration expression.');
                $credentials[$key] = configLiteral($tokens[$index+4]);
            }
        }
        if (is_array($token) && $token[0] === T_VARIABLE && $token[1] === '$table_prefix' && ($tokens[$index+1] ?? null) === '=') {
            if (($tokens[$index+3] ?? null) !== ';') throw new RuntimeException('Unsupported table prefix expression.');
            $prefix = configLiteral($tokens[$index+2]);
        }
    }
    if (count($credentials) !== 4 || !preg_match('/^[A-Za-z0-9_]+$/', $prefix ?? '')) throw new RuntimeException('Literal database configuration or table prefix missing.');
    $connection = new mysqli($credentials['DB_HOST'], $credentials['DB_USER'], $credentials['DB_PASSWORD'], $credentials['DB_NAME']);
    $connection->set_charset('utf8mb4');
    $connection->query('SET TRANSACTION READ ONLY');
    $connection->query('START TRANSACTION WITH CONSISTENT SNAPSHOT');
    $rows = fn(string $sql) => $connection->query($sql)->fetch_all(MYSQLI_ASSOC);
    $catalog = $rows('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()');
    $engines = array_column($catalog, 'ENGINE', 'TABLE_NAME');
    if (strtolower($engines[$prefix.'options'] ?? '') !== 'innodb') throw new RuntimeException('Consistent export requires an InnoDB options table.');
    $optionRows = $rows("SELECT option_name,option_value FROM ".$prefix."options WHERE option_name IN ('home','timezone_string','gmt_offset')");
    $options = array_column($optionRows, 'option_value', 'option_name');
    if (empty($options['home'])) throw new RuntimeException('WordPress home URL missing.');
    $timezone = $options['timezone_string'] ?? '';
    $offset = is_numeric($options['gmt_offset'] ?? null) ? (float)$options['gmt_offset'] : 0.0;
    if ($timezone === '') {
        $minutes = (int)round(abs($offset)*60);
        $timezone = sprintf('%s%02d:%02d', $offset < 0 ? '-' : '+', intdiv($minutes,60), $minutes%60);
    }
    new DateTimeZone($timezone);
    $version = null;
    $pluginFile = $root.'/wp-content/plugins/wp-statistics/wp-statistics.php';
    if (is_file($pluginFile) && preg_match('/Version:\s*([^\r\n]+)/', file_get_contents($pluginFile), $match)) $version = trim($match[1]);
    $definitions = [
        'visitors' => ['visitor','ID',[
            'id'=>['ID','integer'], 'day'=>['last_counter','string'], 'browser'=>['agent','string'],
            'os'=>['platform','string'], 'browserVersion'=>['version','string'], 'device'=>['device','string'],
            'model'=>['model','string'], 'country'=>['location','string'], 'city'=>['city','string'],
            'region'=>['region','string'], 'continent'=>['continent','string'], 'referrer'=>['referred','host'],
            'sourceChannel'=>['source_channel','string'], 'sourceName'=>['source_name','string'],
            'hits'=>['hits','integer'], 'firstPage'=>['first_page','integer'], 'firstView'=>['first_view','datetime'],
            'lastPage'=>['last_page','integer'], 'lastView'=>['last_view','datetime']]],
        'pages'=>['pages','page_id',[
            'id'=>['page_id','integer'], 'uri'=>['uri','uri'], 'type'=>['type','string'],
            'day'=>['date','string'], 'views'=>['count','integer'], 'objectId'=>['id','integer']]],
        'relationships'=>['visitor_relationships','ID',[
            'id'=>['ID','integer'], 'visitorId'=>['visitor_id','integer'], 'pageId'=>['page_id','integer'], 'at'=>['date','datetime']]],
        'daily'=>['summary_totals','ID',[
            'id'=>['ID','integer'], 'day'=>['date','string'], 'visitors'=>['visitors','integer'], 'views'=>['views','integer']]],
        'historical'=>['historical','ID',[
            'id'=>['ID','integer'], 'category'=>['category','string'], 'pageId'=>['page_id','integer'],
            'uri'=>['uri','uri'], 'value'=>['value','integer']]],
        'events'=>['events','ID',[
            'id'=>['ID','integer'], 'at'=>['date','datetime'], 'pageId'=>['page_id','integer'],
            'visitorId'=>['visitor_id','integer'], 'name'=>['event_name','string']]],
    ];
    $required = ['visitors'=>['ID','last_counter','agent','hits'], 'pages'=>['page_id','uri','type','date','count','id'], 'relationships'=>['ID','visitor_id','page_id','date']];
    $capturedAt = gmdate('c'); $tables = []; $missingColumns = [];
    foreach ($definitions as $name => [$suffix,$primary,$fields]) {
        $table = $prefix.'statistics_'.$suffix;
        if (!isset($engines[$table])) {
            if (isset($required[$name])) throw new RuntimeException('Required WP Statistics table missing: '.$suffix);
            $tables[$name] = ['present'=>false,'count'=>0,'sha256'=>hash('sha256','[]'),'rows'=>[]];
            continue;
        }
        if (strtolower($engines[$table]) !== 'innodb') throw new RuntimeException('Consistent export requires InnoDB: '.$suffix);
        $columns = array_column($rows('SHOW COLUMNS FROM '.$table), 'Field');
        foreach ($required[$name] ?? [] as $column) if (!in_array($column,$columns,true)) throw new RuntimeException('Required column missing: '.$suffix.'.'.$column);
        $select = []; $missingColumns[$name] = [];
        foreach ($fields as $field => [$column,$type]) {
            $available = in_array($column,$columns,true);
            if (!$available) $missingColumns[$name][] = $field;
            $select[] = ($available ? chr(96).$column.chr(96) : 'NULL').' AS '.chr(96).$field.chr(96);
        }
        $records = $rows('SELECT '.implode(',',$select).' FROM '.chr(96).$table.chr(96).' ORDER BY '.chr(96).$primary.chr(96));
        foreach ($records as &$record) foreach ($fields as $field => [$column,$type]) {
            $value = $record[$field];
            if ($value === null) continue;
            if ($type === 'integer') {
                if (!preg_match('/^\d+$/',(string)$value) || (float)$value > 9007199254740991) throw new RuntimeException('Unsafe integer: '.$suffix.'.'.$column);
                $record[$field] = (int)$value;
            } elseif ($type === 'datetime') $record[$field] = $value === '' || str_starts_with($value,'0000-') ? null : (string)$value;
            elseif ($type === 'host') {
                $host = parse_url(str_contains($value,'://') ? $value : 'https://'.$value,PHP_URL_HOST);
                $record[$field] = $value === '' ? '' : (is_string($host) ? strtolower($host) : '');
            } elseif ($type === 'uri') {
                if (str_contains($value,'://')) {
                    $parts=parse_url($value);
                    $record[$field]=is_array($parts) ? ($parts['path'] ?? '/').(isset($parts['query'])?'?'.$parts['query']:'') : (string)$value;
                } else $record[$field]=(string)$value;
            } else $record[$field]=(string)$value;
        }
        unset($record);
        $tables[$name] = ['present'=>true,'count'=>count($records),'sha256'=>hash('sha256',snapshotJson($records)),'rows'=>$records];
    }
    $connection->rollback(); $connection->close(); $connection=null;
    $snapshot = ['schema'=>'weava-wp-statistics-v1','source'=>['siteUrl'=>$options['home'],'timezone'=>$timezone,'pluginVersion'=>$version],
        'capturedAt'=>$capturedAt,'databaseReadOnly'=>true,'consistentSnapshot'=>true,'missingColumns'=>$missingColumns,'tables'=>$tables];
    unset($credentials,$config,$tokens);
    echo snapshotJson($snapshot),"\n";
} catch (Throwable $error) {
    if ($connection) { try { $connection->rollback(); $connection->close(); } catch (Throwable $ignored) {} }
    // Connection errors can contain usernames. Keep diagnostics free of credentials.
    $message = $error instanceof mysqli_sql_exception ? 'Read-only database query failed; check credentials and schema on the source host.' : $error->getMessage();
    fwrite(STDERR,snapshotJson(['error'=>$message])."\n");
    exit(1);
}
`;

export function wordpressStatisticsExportScript(
  wordpressRoot: string,
  format: 'shell' | 'php' = 'shell',
) {
  if (!wordpressRoot.startsWith('/') || /[\r\n\0]/.test(wordpressRoot))
    throw new WeavaError('请提供 WordPress 服务器上的绝对目录。');
  const php = wordpressStatisticsPhp.replace(
    '__WEAVA_WORDPRESS_ROOT__',
    Buffer.from(wordpressRoot.replace(/\/$/, '')).toString('base64'),
  );
  return format === 'php'
    ? php
    : "php <<'WEAVA_WP_STATISTICS_READONLY'\n" + php + '\nWEAVA_WP_STATISTICS_READONLY\n';
}
export function writeWordpressStatisticsExportScript(
  wordpressRoot: string,
  output: string,
  format: 'shell' | 'php' = 'shell',
) {
  const path = resolve(output),
    script = wordpressStatisticsExportScript(wordpressRoot, format);
  writeFileSync(path, script, { flag: 'wx' });
  return {
    path,
    format,
    bytes: Buffer.byteLength(script),
    sha256: digest(script),
    databaseReadOnly: true,
  };
}
