<?php
// Offline test double, loaded only with php -n -d auto_prepend_file=... .
// Reject every SQL statement except the read-only exporter protocol.
define('MYSQLI_REPORT_ERROR', 1);
define('MYSQLI_REPORT_STRICT', 2);
define('MYSQLI_ASSOC', 1);
function mysqli_report($flags) {}
class mysqli_sql_exception extends RuntimeException {}
class FixtureResult {
    public function __construct(private array $rows) {}
    public function fetch_all($mode): array { return $this->rows; }
}
class mysqli {
    private array $fixture;
    private array $queries=[];
    public function __construct($host,$user,$password,$name) {
        $this->fixture=json_decode(file_get_contents(getenv('WEAVA_WP_FIXTURE')),true,512,JSON_THROW_ON_ERROR);
        if($password!=='fixture-secret')throw new mysqli_sql_exception('fixture username and password must not escape');
    }
    public function set_charset($charset) { if($charset!=='utf8mb4')throw new RuntimeException('Unexpected charset.'); }
    public function query(string $sql) {
        $this->queries[]=$sql;
        if(in_array($sql,['SET TRANSACTION READ ONLY','START TRANSACTION WITH CONSISTENT SNAPSHOT'],true))return true;
        if($sql==='SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()')return new FixtureResult(array_map(fn($name)=>['TABLE_NAME'=>$name,'ENGINE'=>$this->fixture['engine']??'InnoDB'],array_keys($this->fixture['tables'])));
        if(str_starts_with($sql,'SELECT option_name,option_value FROM '))return new FixtureResult($this->fixture['options']);
        if(str_starts_with($sql,'SHOW COLUMNS FROM ')) {
            $name=substr($sql,18);
            $rows=$this->fixture['tables'][$name];
            return new FixtureResult(array_map(fn($column)=>['Field'=>$column],$this->fixture['columns'][$name]??array_keys($rows[0]??[])));
        }
        if(preg_match('/^SELECT (.+) FROM `([^`]+)` ORDER BY `([^`]+)`$/',$sql,$match)) {
            if(($this->fixture['failTable']??null)===$match[2])throw new mysqli_sql_exception('fixture-secret must not be printed');
            $records=$this->fixture['tables'][$match[2]];
            usort($records,fn($a,$b)=>$a[$match[3]]<=>$b[$match[3]]);
            $select=explode(',',$match[1]);$result=[];
            foreach($records as $row){$out=[];foreach($select as $field){
                if(!preg_match('/^(?:`([^`]+)`|(NULL)) AS `([^`]+)`$/',$field,$part))throw new RuntimeException('Unexpected select expression.');
                $out[$part[3]]=$part[2]==='NULL'?null:$row[$part[1]];
            }$result[]=$out;}
            return new FixtureResult($result);
        }
        throw new RuntimeException('Unexpected SQL: '.$sql);
    }
    public function rollback() { $this->queries[]='ROLLBACK'; }
    public function close() { file_put_contents(getenv('WEAVA_WP_QUERY_LOG'),json_encode($this->queries,JSON_THROW_ON_ERROR)); }
}
