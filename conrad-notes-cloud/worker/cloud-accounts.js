'use strict';
function configureAuthForm(){showLogin(false);}
function clearIdentityView(){
 ['boardJournal','boardNote','review','tomorrow','historyList','weekGoals','dimensionGrid','priorities'].forEach(id=>{const el=$(id);if(el){if('value'in el)el.value='';el.textContent='';}});
}
function applyIdentity(user){if(!currentUser||currentUser.id!==user.id){drafts.clear();state={revision:0,data:{days:{},settings:{}}};clearIdentityView();}currentUser=user;renderAccount();}
function renderAccount(){
 $('accountPanel').hidden=!currentUser||view!=='settings';
 $('inviteAdmin').hidden=true;$('newInvite').hidden=true;$('memberInviteHelp').hidden=true;
 if(!currentUser)return;
 $('accountIdentity').textContent=currentUser.name+' · ChatGPT云端账号';
 $('greeting').textContent=currentUser.name+'，今天按自己的节奏来。';
}
$('logout').onclick=$('accountLogout').onclick=()=>{location.href='/signout-with-chatgpt?return_to=%2F';};
document.getElementById('cloudAddTask').onclick=()=>{setView('today');openDialog('add');};
