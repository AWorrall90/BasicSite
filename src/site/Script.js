function myClick(){
    document.getElementById("message").innerHTML="goodbye world";
    document.getElementById("message").setAttribute("style","color:red")
}

function restoreClick(){
    document.getElementById("message").innerHTML="hello world";
    document.getElementById("message").setAttribute("style","color:black")
}