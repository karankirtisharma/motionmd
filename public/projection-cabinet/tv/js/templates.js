const referenceList=()=>[films[2].slug, films[3].slug, films[19].slug];
const settings=Object.assign({volume:35, captions:false, motion:false, lite:false}, stored('cabinet.settings', {}));
let suspendedPreview=null,controlFrom='home',indexFilm=films[3],audioCtx;
const keyFor=f=>f===films[3]?'coastal':f===films[2]?'shelf-fragrance':f===films[19]?'shelf-sola':f.id;
const thumbFor=f=>f.formatId==='product-launch'?'rail-'+f.industryId:keyFor(f);
const plate=(key, alt='')=>pic(key, alt);
// One recorded family covers the interface (js/sound.js). Each control asks for the sound that fits it.
function soundFor(el){
  if(el.matches('[data-pref]'))return 'switch';
  if(el.matches('[data-cmd="play"]'))return 'shutter';
  if(el.matches('[data-cmd="save"]'))return el.getAttribute('aria-pressed')==='true'?'tick':'save';
  if(el.matches('.dockframe,.mcell,.choice,.step,.siblingrail a,[data-cmd="stage"]'))return 'select';
  if(el.matches('.act'))return 'press';
  return 'tick'
}
function tickSound(kind='tick'){
  if(!settings.volume)return;
  if(CabinetSound.play(kind, settings.volume/100))return;
  try{
    audioCtx??=new AudioContext();
    const osc=audioCtx.createOscillator(),gain=audioCtx.createGain(),t=audioCtx.currentTime;
    osc.type='sine';
    osc.frequency.setValueAtTime(570, t);
    osc.frequency.exponentialRampToValueAtTime(270, t+.045);
    gain.gain.setValueAtTime(.055*settings.volume/100, t);
    gain.gain.exponentialRampToValueAtTime(.0001, t+.065);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t+.07)
  }catch{}
}
function head(r){
  const n=(id, label, on)=>link(id, label, 'navitem'+(on?' active':''));
  return '<header class="bar"><a href="#ui/home" class="signature">Motiondesign.ad</a><span class="cabinetword">Projection Cabinet</span><nav class="navgroup" aria-label="Main">'+n('work', 'Work', !['studio', 'brief', 'shared', 'saved', 'controls'].includes(r.kind)&&r.group!=='Studio')+n('studio', 'Studio', r.group==='Studio')+n('saved', 'Shortlist'+(shortlist.length?' ('+shortlist.length+')':''), r.kind==='saved'||r.kind==='shared')+
    '</nav><div class="bartools"><a aria-label="Search collection" class="tool" href="#ui/search">'+icon('search')+
    '</a>'+link('controls', 'Controls', 'bare')+link('brief/format', 'Start a brief', 'act small', 'arrow')+
    '</div></header>'
};
function home(){
  const f=selected[heroPos],name=['AURELLE', 'Vanta', 'Northlane', 'Kairo', 'Food & Beverage'][heroPos];
  return '<section class="launch"><div class="launchimage">'+plate(f===films[3]?'coastal':'hero-'+f.industryId)+
    '</div><div class="launchtitle"><span class="tagline">Featured work / '+industry(f.industryId)+
    '</span><h1>'+name+
    '</h1><p>Launch Film</p><div class="actions">'+link('view/'+f.slug, icon('play')+(approvedSource(f)?' Play film':' Motion preview'), 'act')+link('study/'+f.slug, 'Case study', 'underlink', 'arrow')+link('film/'+f.slug, 'Film details', 'underlink')+
    '</div></div><div class="launchdock glassrim">'+films.slice(0, 5).map(s=>'<button class="dockframe '+(s===f?'on':'')+'" data-cmd="hero" data-value="'+selected.indexOf(s)+'" aria-pressed="'+(s===f)+'" aria-label="Feature '+esc(s.title)+'">'+plate(thumbFor(s))+
    '<span>'+esc(industry(s.industryId))+
    '</span></button>').join('')+
    '</div></section>'
};
const origPlayer=player;
player=function(r){
  const f=r.kind==='reel'?selected[0]:r.item;
  return origPlayer(r).replace('class="player"', 'class="player inspection"').replace('class="playtop"', 'class="playtop"').replace(pic(f.id), pic(keyFor(f))).replace('<div class="transport glass">', '<div class="cuecaption" '+(settings.captions?'':'hidden')+'>'+esc(r.kind==='reel'?'Featured launch concept':industry(f.industryId)+' · '+format(f.formatId)+' concept artwork')+
    '</div><div class="transport glassrim">'+link('controls', 'Control Center', 'glassbtn'))
};
function film(r){
  const f=r.item,list=films.filter(o=>o.formatId===f.formatId);
  return '<section class="folio"><div class="foliocopy">'+crumb(['work', 'format/'+f.formatId])+
    '<span class="tagline">'+esc(industry(f.industryId))+' / Concept '+number(films.indexOf(f)+1)+
    '</span><h1>'+esc(f.title)+
    '</h1><p class="desc">'+formatCopy[fidx(f)]+
    '</p><div class="facts"><div><dt>Format</dt><dd>'+link('format/'+f.formatId, format(f.formatId), '')+
    '</dd></div><div><dt>Industry</dt><dd>'+link('industry/'+f.industryId, industry(f.industryId), '')+
    '</dd></div></div><div class="actions">'+link('view/'+f.slug, approvedSource(f)?'Play film':'Motion preview', 'act', 'play')+saveButton(f)+(routes['study/'+f.slug]?link('study/'+f.slug, 'Frame study', 'glassbtn', 'arrow'):'')+(f===films[2]&&!approvedSource(f)?link('unavailable', 'Full film', 'glassbtn'):'')+
    '</div></div><div class="folioboard"><div class="foliostill glassrim">'+plate(keyFor(f), f.title)+
    '<span class="artcaption">Portfolio / Concept artwork</span></div><div class="siblingrail"><span>Browse this<br><em>format.</em></span>'+list.map(s=>'<a class="'+(s===f?'on':'')+'" title="'+esc(s.title)+'" aria-label="'+esc(s.title)+'" href="#ui/film/'+s.slug+'">'+plate(thumbFor(s))+
    '</a>').join('')+
    '</div></div></section>'
};
const origMatrix=matrix;
matrix=function(){
  let table=origMatrix();
  for(const f of films){
    const key='matrix-'+iidx(f)+'-'+fidx(f);
    table=table.replace(pic(f.id), pic(key))
  }
  return table.replace('class="inner"', 'class="inner contactindex"').replace(crumb(['home', 'work']), '').replace('All <em>50</em> films.', 'Film index').replace('Pick a frame where format and industry meet.', '50 films · Select a frame to inspect it.').replace('</table></div></section>', '</table></div><div class="matrixbase" id="inspectentry">'+indexDetail()+'</div></section>');
};
function indexDetail(){
  return plate(keyFor(indexFilm))+ '<div><span class="eyebrow">'+industry(indexFilm.industryId)+'</span><h2>'+esc(indexFilm.title)+
    '</h2></div>'+link('film/'+indexFilm.slug, 'Open film', 'glassbtn', 'arrow')
}
app.addEventListener('click', e=>{
  const cell=e.target.closest('.mcell');
  if(cell&&!(e.metaKey||e.ctrlKey||e.shiftKey)){
    e.preventDefault();
    indexFilm=films.find(f=>cell.hash.endsWith('/'+f.slug));
    app.querySelector('#inspectentry').innerHTML=indexDetail();
    app.querySelectorAll('.mcell').forEach(c=>c.classList.toggle('picked', c===cell));
    window.FX?.inspect()
  }
  const opt=e.target.closest('[data-pref]');
  if(opt){
    const key=opt.dataset.pref;
    settings[key]=!settings[key];
    put('cabinet.settings', settings);
    refresh('[data-pref="'+key+'"]')
  }
  if(e.target.closest('[data-take]')){
    shortlist=[...new Set([...shortlist, ...shareIDs])];
    put('saved', shortlist);
    location.hash='ui/brief/format'
  }
  const pressed=e.target.closest('#content.liveframe button,#content.liveframe a');
  if(pressed)tickSound(soundFor(pressed))
});
app.addEventListener('input', e=>{
  if(e.target.id==='volume'){
    settings.volume=+e.target.value;
    put('cabinet.settings', settings);
    app.querySelector('#volumevalue').textContent=settings.volume+'%';
    app.querySelector('.knob').style.setProperty('--turn', (settings.volume*2.7-135)+'deg');
    // Let the dial be heard at its new level while it turns, a few times a second at most.
    if(performance.now()-(tickSound.heard||0)>110){
      tickSound.heard=performance.now();
      tickSound()
    }
  }
});
function controlPage(){
  const toggle=(key, title, a, b)=>'<button class="switchgroup" data-pref="'+key+'" aria-pressed="'+!!settings[key]+'"><strong>'+title+
    '</strong><span class="selector"><i class="'+(!settings[key]?'chosen':'')+'">'+a+
    '</i><i class="'+(settings[key]?'chosen':'')+'">'+b+
    '</i></span></button>';
  return '<section class="controlpage"><div class="watchbanner">'+
    '<picture><source media="(max-width:760px)" srcset="'+images.driver+'">'+plate('crown')+
    '</picture></div><div class="controlconsole glassrim"><div class="controlmast"><div><span class="eyebrow">Viewing preferences</span><h1>Control Center</h1></div>'+link(controlFrom, 'Close '+icon('exit'), 'glassbtn')+
    '</div><div class="controlgrid"><label class="sound"><div class="knob" style="--turn:'+(settings.volume*2.7-135)+
    'deg"></div><div><strong>Interface sound</strong><output id="volumevalue">'+settings.volume+
    '%</output><input type="range" aria-label="Interface sound volume" id="volume" min="0" max="100" value="'+settings.volume+
    '"></div></label>'+toggle('captions', 'Artwork captions', 'Off', 'On')+toggle('motion', 'Reduce motion', 'Off', 'On')+toggle('lite', 'Viewing mode', 'Dimensional', 'Lite')+
    '</div></div></section>'
}
function unavailable(){
  return '<section class="fault"><div>'+crumb(['work', 'film/aurelle-launch-film'])+
    '<span class="tagline">AURELLE Launch Film</span><h1>Film preview<br><em>unavailable.</em></h1><p class="desc">You can still explore the production frames for this project.</p><div class="actions">'+link('study/aurelle-launch-film', 'View case study', 'act', 'arrow')+link('index', 'Back to films', 'glassbtn')+
    '</div></div><figure class="stripmount glassrim"><div class="perforation"></div>'+plate('flower', 'AURELLE flower frame')+
    '<div class="perforation"></div></figure></section>'
}
const lookup=searchResults;
searchResults=function(q){
  if(!/^(perfume|fragrance)$/i.test(q.trim()))return lookup(q);
  const a=[films[2], films[17], films[7]];
  return {
    count:'3 curated fragrance references',
    html:'<div class="resultstrip">'+a.map((f, i)=>'<a href="#ui/film/'+f.slug+'">'+plate('search-'+['launch', 'social', 'brand'][i])+'<div><strong>'+esc(f.title)+
      '</strong><small>'+format(f.formatId)+
      ' / Fragrance</small></div>'+icon('arrow')+
      '</a>').join('')+
      '</div>'
  }
}
function searchPage(){
  const res=searchResults(searchString);
  return '<section class="searchdesk"><div class="backstrip">'+films.filter(f=>f.industryId==='beauty-fragrance').map(f=>plate(f.id)).join('')+
    '</div><div class="searchsheet glassrim"><div class="caprow"><h1>Projection Cabinet</h1><span class="smallcap" id="matchcount" aria-live="polite">'+res.count+
    '</span></div><div class="searchbar">'+icon('search')+
    '<input id="filmsearch" class="searchinput" aria-label="Search films" type="search" value="'+esc(searchString)+'" placeholder="Search film, format or industry">'+link('index', 'Close', 'bare', 'exit')+
    '</div><div class="resultzone" id="results">'+res.html+
    '</div></div></section>'
};
const originalStudy=study;
study=function(r){
  let out=originalStudy(r).replace('class="inner"', 'class="inner production"').replace('frame study.', 'production study.');
  const f=r.item,isWatch=f===films[1],key=activeStage==='animatic'?'exploded':'watch-'+activeStage;
  if(isWatch)out=out.replace(pic('consumer-tech-'+activeStage, studyLabels[studyKeys.indexOf(activeStage)]+' for '+f.title), pic(key, 'Kairo '+activeStage));
  return out.replace('<div class="frameTabs">', '<div class="frameTabs shotstrip">').replace(/(<button[^>]*data-cmd="stage" data-value="([^"]+)"[^>]*>)/g, (all, start, k)=>start+plate(isWatch?(k==='animatic'?'exploded':'watch-'+k):f.industryId+'-'+k));
};
const originalSaved=libraryPage;
libraryPage=function(r){
  let out=originalSaved(r).replace('class="inner"', 'class="inner savedpage"').replace('class="resultzone"', 'class="resultzone marbletray"');
  if(r.kind==='shared'&&shareIDs.length)out=out.replace('<div class="actions">', '<div class="actions"><button class="act" data-take>Use these in a brief '+icon('arrow')+'</button>');
  for(const [f, k] of [[films[2], 'shelf-fragrance'], [films[3], 'shelf-vanta'], [films[19], 'shelf-sola']])out=out.replace(pic(f.id), pic(k));
  return out;
};
